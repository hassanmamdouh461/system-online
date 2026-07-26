/**
 * Integration test for the Worker's session gate (fix #1) against a stub D1.
 *
 * Asserts the audit's acceptance criteria end-to-end through the real fetch()
 * handler in src/index.ts:
 *   - a protected read WITHOUT a session cookie → 401
 *   - POST /v1/session with the manager password → 200 + Set-Cookie
 *   - the same read WITH that cookie → not 401 (gate passes)
 *   - the public QR menu stays open without any session
 *
 *   node --experimental-strip-types test/session.integration.test.mts
 */

import assert from "node:assert/strict";
import worker from "../src/index.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function clientHashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  return { hash: bufToHex(new Uint8Array(exported)), salt: bufToHex(salt) };
}

const MANAGER_PASSWORD = "mgr-integration-7781";

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
          // Any collection read returns one live menu row so the gate's success
          // path produces a 200 rather than an empty-table edge case.
          return { results: [{ id: "m1", name: "Latte", available: 1, deleted_at: null }] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
}

async function main() {
  const creds = await clientHashPassword(MANAGER_PASSWORD);
  const DB = makeStubDB({
    brewmaster_manager_creds_v1: JSON.stringify({ username: "manager", ...creds }),
  });
  const env: any = {
    DB,
    SESSION_SECRET: "integration-secret",
    ALLOWED_ORIGINS: "https://pos.engaz.tech",
  };
  const ORIGIN = { Origin: "https://pos.engaz.tech" };
  const READ_URL = "https://api.engaz.tech/v1/databases/default/collections/orders/documents";

  console.log("\n1) protected read without a session → 401");
  const unauth = await worker.fetch(new Request(READ_URL, { headers: ORIGIN }), env);
  ok(unauth.status === 401, "no cookie → 401");

  console.log("\n2) mint a manager session");
  const mint = await worker.fetch(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      headers: { ...ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ password: MANAGER_PASSWORD }),
    }),
    env
  );
  ok(mint.status === 200, "POST /v1/session with manager password → 200");
  const setCookie = mint.headers.get("Set-Cookie") || "";
  const cookie = setCookie.split(";")[0];
  ok(cookie.startsWith("pos_session="), "Set-Cookie carries the session");

  console.log("\n3) same read WITH the cookie → gate passes (not 401)");
  const authed = await worker.fetch(new Request(READ_URL, { headers: { ...ORIGIN, Cookie: cookie } }), env);
  ok(authed.status !== 401, `cookie read is not 401 (got ${authed.status})`);

  console.log("\n4) public QR menu stays open with no session");
  const pub = await worker.fetch(
    new Request("https://api.engaz.tech/public/menu", { headers: ORIGIN }),
    env
  );
  ok(pub.status === 200, "GET /public/menu → 200 without a session");

  console.log(`\n✅ session.integration: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ session.integration FAILED:", err);
  process.exit(1);
});
