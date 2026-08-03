/**
 * Recovery-path guard: prove the bootstrap seed script and the Worker agree.
 *
 * The 401 session-bootstrap deadlock is recovered by seeding the PBKDF2
 * credential rows into D1 with scripts/seed-manager-credential.mjs. That only
 * works while the script's KDF stays byte-identical to the Worker's verifier
 * (auth.ts). If a future refactor changes either side, seeding would silently
 * produce rows the Worker rejects — the deadlock would recur with no obvious
 * cause.
 *
 * This test closes that gap: it builds credential rows with the ACTUAL seed
 * script (imported, not reimplemented), stuffs them into a stub D1, and drives
 * the REAL Worker fetch handler. If the KDFs ever drift, the mint assertions
 * below fail in CI instead of in production.
 *
 *   node --experimental-strip-types test/seed-bootstrap.integration.test.mts
 */

import assert from "node:assert/strict";
import worker from "../src/index.ts";
import {
  buildCredentialValue,
  credentialInsertSql,
  MANAGER_CREDS_KEY,
  CASHIER_CREDS_KEY,
} from "../../scripts/seed-manager-credential.mjs";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

const MANAGER_PASSWORD = "seed-mgr-9931";
const CASHIER_PASSWORD = "seed-cash-4420";

/** Stub D1 that serves the seeded credential rows exactly as the seed file would. */
function makeStubDB(settings: Record<string, string>) {
  return {
    prepare(sql: string) {
      const state: { key: string | null } = { key: null };
      return {
        bind(...args: any[]) {
          state.key = args[0];
          return this;
        },
        async first() {
          if (/FROM settings/i.test(sql) && state.key && state.key in settings) {
            return { value: settings[state.key] };
          }
          return null;
        },
        async all() {
          return { results: [{ id: "m1", name: "Latte", available: 1, deleted_at: null }] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
}

/**
 * Pull one named cookie out of a response that may carry several Set-Cookie
 * headers (a mint sets the role cookie AND clears the legacy shared one).
 */
function pickCookie(res: Response, name: string): string {
  const all =
    typeof (res.headers as any).getSetCookie === "function"
      ? (res.headers as any).getSetCookie()
      : (res.headers.get("Set-Cookie") || "").split(/,\s*(?=[A-Za-z0-9_-]+=)/);
  for (const raw of all) {
    const first = String(raw).split(";")[0].trim();
    if (first.startsWith(`${name}=`)) return first;
  }
  return "";
}

async function main() {
  // Build the rows with the real seed script.
  const managerValue = await buildCredentialValue("manager", MANAGER_PASSWORD);
  const cashierValue = await buildCredentialValue("admin", CASHIER_PASSWORD);

  console.log("\n0) the seed script emits a well-formed credential + SQL");
  const mgr = JSON.parse(managerValue);
  ok(/^[0-9a-f]{64}$/.test(mgr.hash), "manager hash is 32 bytes hex");
  ok(/^[0-9a-f]{32}$/.test(mgr.salt), "manager salt is 16 bytes hex");
  const sql = credentialInsertSql(MANAGER_CREDS_KEY, managerValue);
  ok(sql.includes("INSERT OR REPLACE INTO settings"), "emits INSERT OR REPLACE");
  ok(sql.includes(`'global::${MANAGER_CREDS_KEY}'`), "row id is global::<key> (matches the POS)");

  // Seed a stub D1 exactly as the SQL file would.
  const DB = makeStubDB({
    [`global::${MANAGER_CREDS_KEY}`]: managerValue,
    [`global::${CASHIER_CREDS_KEY}`]: cashierValue,
  });
  const env: any = { DB, SESSION_SECRET: "seed-integration-secret", ALLOWED_ORIGINS: "https://pos.engaz.tech" };
  const ORIGIN = { Origin: "https://pos.engaz.tech" };
  const READ_URL = "https://api.engaz.tech/v1/databases/default/collections/orders/documents";

  const mint = (password: string) =>
    worker.fetch(
      new Request("https://api.engaz.tech/v1/session", {
        method: "POST",
        headers: { ...ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
      env
    );

  console.log("\n1) manager password (seeded) mints a manager session");
  const mgrMint = await mint(MANAGER_PASSWORD);
  ok(mgrMint.status === 200, "POST /v1/session with seeded manager password → 200");
  const mgrBody: any = await mgrMint.json();
  ok(mgrBody.role === "manager", "minted role is manager");
  // Sessions are role-scoped cookies (pos_session_manager / pos_session_cashier)
  // so a manager and a cashier tab in the SAME browser no longer overwrite each
  // other's session. The legacy `pos_session` name is cleared in the same
  // response, so pick the role cookie out of the (possibly multi-value) header.
  const cookie = pickCookie(mgrMint, "pos_session_manager");
  ok(cookie.startsWith("pos_session_manager="), "Set-Cookie carries the manager session");

  console.log("\n2) that cookie authenticates a protected read");
  const authed = await worker.fetch(new Request(READ_URL, { headers: { ...ORIGIN, Cookie: cookie } }), env);
  ok(authed.status !== 401, `seeded-cookie read is not 401 (got ${authed.status})`);

  console.log("\n3) cashier password (seeded) mints a cashier session");
  const cashMint = await mint(CASHIER_PASSWORD);
  ok(cashMint.status === 200, "POST /v1/session with seeded cashier password → 200");
  const cashBody: any = await cashMint.json();
  ok(cashBody.role === "cashier", "minted role is cashier");

  console.log("\n4) a wrong password is still rejected");
  const wrong = await mint("not-the-password");
  ok(wrong.status === 401, "wrong password → 401");

  console.log(`\n✅ seed-bootstrap.integration: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ seed-bootstrap.integration FAILED:", err);
  process.exit(1);
});
