#!/usr/bin/env node
/**
 * One-time bootstrap: seed the POS login CREDENTIALS into Cloudflare D1.
 *
 * WHY THIS EXISTS  (the 401 session-bootstrap deadlock)
 * -----------------------------------------------------
 * The Worker mints a session by verifying the typed password against a PBKDF2
 * hash stored in D1 `settings` (see cloudflare-worker/src/auth.ts →
 * resolvePasswordRole):
 *     brewmaster_manager_creds_v1  ⇒ manager
 *     brewmaster_admin_creds_v2    ⇒ cashier
 * Writing those rows requires a manager session, and minting a manager session
 * requires the rows. On a fresh / partly-provisioned D1 that is a chicken-and-egg
 * deadlock: POST /v1/session returns 401, no Set-Cookie is issued, every
 * authenticated read returns 401, and the POS renders empty.
 *
 * This script breaks the deadlock WITHOUT weakening the Worker (no anonymous
 * bootstrap endpoint, no default hash baked into the repo): the operator runs it
 * locally with password(s) of their choice, and it derives the EXACT same PBKDF2
 * hash the browser POS produces (src/utils/settingsConfig.ts → hashPassword) and
 * the Worker verifies (auth.ts → derivePasswordHashHex). The password never
 * leaves the operator's machine and is never committed — only the salted hash is
 * written, inside a ready-to-run `wrangler d1 execute` seed file.
 *
 * The KDF here is pinned byte-for-byte to the client and the Worker
 * (PBKDF2-SHA256, 100k iterations → AES-GCM-256 raw key → hex). A CI test
 * (cloudflare-worker/test/seed-bootstrap.integration.test.mts) feeds this
 * module's output through the real Worker to guarantee they never drift apart —
 * so this recovery path cannot silently break.
 *
 * USAGE  (seed BOTH roles in one file — recommended)
 * --------------------------------------------------
 *   MANAGER_PASSWORD='strong-manager-pass' \
 *   CASHIER_PASSWORD='strong-cashier-pass' \
 *   node scripts/seed-manager-credential.mjs
 *
 * Seed only one role by supplying only that password:
 *   MANAGER_PASSWORD='strong-manager-pass' node scripts/seed-manager-credential.mjs
 *   CASHIER_PASSWORD='strong-cashier-pass' node scripts/seed-manager-credential.mjs
 *
 * Positional fallback (manager, then cashier):
 *   node scripts/seed-manager-credential.mjs 'manager-pass' 'cashier-pass'
 *
 * Optional env: MANAGER_USERNAME (default 'manager'), CASHIER_USERNAME
 * (default 'admin'), OUT (default 'seed-credentials.sql').
 *
 * Then apply it to the REMOTE D1 (from the cloudflare-worker/ folder):
 *   cd cloudflare-worker
 *   npx wrangler d1 execute system-online-db --remote --file=../seed-credentials.sql
 *
 * After it runs, log in with that password on the POS and change it from
 * Settings if you like — a normal manager session can now write it, and because
 * the seeded row's id is `global::<key>` (identical to what the POS writes) the
 * change REPLACEs this row instead of creating a duplicate.
 */

import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** MUST match settingsConfig.hashPassword + auth.ts. Do not change in isolation. */
export const PBKDF2_ITERATIONS = 100000;
/** D1 settings keys the Worker reads for each role (auth.ts). */
export const MANAGER_CREDS_KEY = 'brewmaster_manager_creds_v1';
export const CASHIER_CREDS_KEY = 'brewmaster_admin_creds_v2';
/** Single-branch system: the one branch id every row is stamped with. */
export const BRANCH_ID = 'main_branch';

const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));

/**
 * Byte-for-byte mirror of settingsConfig.ts → hashPassword and auth.ts →
 * derivePasswordHashHex (PBKDF2 → AES-GCM-256 raw key → hex).
 * @returns {Promise<{ hash: string, salt: string }>} both hex-encoded.
 */
export async function hashPassword(pw, saltBytes) {
  const salt = saltBytes ?? crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', derivedKey);
  return { hash: toHex(raw), salt: toHex(salt) };
}

/**
 * Build the exact JSON `value` the POS stores for a credential row
 * (`{ username, hash, salt }`), with a re-derivation self-check so a bad row can
 * never be written.
 * @returns {Promise<string>} JSON string.
 */
export async function buildCredentialValue(username, password) {
  if (!password) throw new Error('password is required');
  const { hash, salt } = await hashPassword(password);
  // Self-check: re-derive with the same salt and confirm reproducibility — this
  // is exactly what the Worker does when verifying a login.
  const check = await hashPassword(password, hexToBytes(salt));
  if (check.hash !== hash) {
    throw new Error('hash self-check failed — refusing to emit a bad credential row');
  }
  return JSON.stringify({ username, hash, salt });
}

/** SQL-escape a single-quoted string literal (double any embedded quote). */
function sqlQuote(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * A single `INSERT OR REPLACE` for one credential row. id is `global::<key>` so
 * it collides with (and is later replaced by) the row the POS itself writes.
 */
export function credentialInsertSql(key, value, branchId = BRANCH_ID, nowIso = new Date().toISOString()) {
  const docId = `global::${key}`;
  return (
    `INSERT OR REPLACE INTO settings (id, key, value, branch_id, updated_at) VALUES (\n` +
    `  '${sqlQuote(docId)}',\n` +
    `  '${sqlQuote(key)}',\n` +
    `  '${sqlQuote(value)}',\n` +
    `  '${sqlQuote(branchId)}',\n` +
    `  '${sqlQuote(nowIso)}'\n` +
    `);\n`
  );
}

async function runCli() {
  const managerPassword = process.env.MANAGER_PASSWORD || process.argv[2] || '';
  const cashierPassword = process.env.CASHIER_PASSWORD || process.argv[3] || '';
  const managerUsername = process.env.MANAGER_USERNAME || 'manager';
  const cashierUsername = process.env.CASHIER_USERNAME || 'admin';
  const out = process.env.OUT || 'seed-credentials.sql';

  if (!managerPassword && !cashierPassword) {
    console.error('ERROR: provide at least one password.');
    console.error("  MANAGER_PASSWORD='…' CASHIER_PASSWORD='…' node scripts/seed-manager-credential.mjs");
    console.error('  (or positionally: node scripts/seed-manager-credential.mjs <manager-pass> [cashier-pass])');
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  const parts = [
    `-- Generated by scripts/seed-manager-credential.mjs on ${nowIso}`,
    `-- Seeds the POS login credential(s) into D1 so the operator can sign in.`,
    `-- The password is NOT stored — only a PBKDF2-SHA256 (100k) salted hash.`,
    ``,
  ];
  const summary = [];

  if (managerPassword) {
    const value = await buildCredentialValue(managerUsername, managerPassword);
    parts.push(credentialInsertSql(MANAGER_CREDS_KEY, value, BRANCH_ID, nowIso));
    summary.push({ role: 'manager', key: MANAGER_CREDS_KEY, username: managerUsername, value });
  }
  if (cashierPassword) {
    const value = await buildCredentialValue(cashierUsername, cashierPassword);
    parts.push(credentialInsertSql(CASHIER_CREDS_KEY, value, BRANCH_ID, nowIso));
    summary.push({ role: 'cashier', key: CASHIER_CREDS_KEY, username: cashierUsername, value });
  }

  writeFileSync(out, parts.join('\n') + '\n');

  console.log(`✓ Wrote ${out}`);
  for (const s of summary) {
    const parsed = JSON.parse(s.value);
    console.log(`  ${s.role.padEnd(7)} key=${s.key} username=${s.username} salt=${parsed.salt} hash=${parsed.hash.slice(0, 16)}… (${parsed.hash.length} hex chars)`);
  }
  console.log('');
  console.log('Apply to REMOTE D1:');
  console.log('  cd cloudflare-worker');
  console.log(`  npx wrangler d1 execute system-online-db --remote --file=../${out}`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
