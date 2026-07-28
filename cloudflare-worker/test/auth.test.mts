/**
 * Verification for the role-bearing, credential-gated session auth (fix #1 + #2).
 *
 * Asserts the acceptance criteria the audit called out:
 *   - POST /v1/session with NO credential → 401 (no anonymous sessions)
 *   - POST /v1/session with a wrong password → 401
 *   - POST /v1/session with the manager password → 200 + Set-Cookie, role=manager
 *   - POST /v1/session with the cashier password → 200, role=cashier
 *   - the minted cookie authenticates a later request AND carries the role
 *   - with SESSION_SECRET unset the Worker fails closed (503), never a default
 *   - the Worker's PBKDF2 verify is byte-compatible with the client hashPassword
 *
 * Zero dependencies: Node 22.6+/24 strips the TypeScript at load and provides
 * fetch/Request/Response/crypto.subtle.
 *   node --experimental-strip-types test/auth.test.mts
 */

import assert from "node:assert/strict";
import {
  mintSessionToken,
  verifySessionToken,
  authenticate,
  resolveKeyRole,
  resolvePasswordRole,
  handleSessionRoutes,
  SESSION_COOKIE,
} from "../src/auth.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

// ─── Client-compatible PBKDF2 hash (mirror of settingsConfig.hashPassword) ─────
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

// ─── Stub D1 holding the credential rows the client would have synced ──────────
function makeStubDB(rows: Record<string, string>) {
  return {
    prepare(sql: string) {
      return {
        _key: null as string | null,
        bind(...args: any[]) {
          this._key = args[0];
          return this;
        },
        async first() {
          if (/FROM settings/i.test(sql) && this._key && this._key in rows) {
            return { value: rows[this._key] };
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
}

const MANAGER_PASSWORD = "manager-pass-9931";
const CASHIER_PASSWORD = "cashier-pass-4402";

const CORS = { "Access-Control-Allow-Origin": "https://pos.engaz.tech" };

async function main() {
  const managerCreds = await clientHashPassword(MANAGER_PASSWORD);
  const cashierCreds = await clientHashPassword(CASHIER_PASSWORD);
  const DB = makeStubDB({
    "global::brewmaster_manager_creds_v1": JSON.stringify({ username: "manager", ...managerCreds }),
    "global::brewmaster_admin_creds_v2": JSON.stringify({ username: "admin", ...cashierCreds }),
  });

  const env: any = { DB, SESSION_SECRET: "unit-test-secret-do-not-ship" };

  console.log("\n1) token mint bakes a verifiable role");
  const minted = await mintSessionToken(env, "manager");
  ok(minted && minted.token, "mintSessionToken returns a token");
  const payload = await verifySessionToken(minted!.token, env);
  ok(payload && payload.role === "manager", "verifySessionToken recovers role=manager");

  console.log("\n2) tampering / expiry / wrong secret are rejected");
  ok((await verifySessionToken(minted!.token + "x", env)) === null, "tampered signature → null");
  ok(
    (await verifySessionToken(minted!.token, { ...env, SESSION_SECRET: "other" })) === null,
    "wrong secret → null"
  );

  console.log("\n3) fail-closed with no SESSION_SECRET");
  ok((await mintSessionToken({ DB } as any, "manager")) === null, "mint returns null without secret");

  console.log("\n4) resolveKeyRole maps keys → roles");
  const keyEnv: any = { DB, MANAGER_API_KEY: "MK", CASHIER_API_KEY: "CK", API_KEY: "LEG" };
  ok(resolveKeyRole("MK", keyEnv)?.role === "manager", "MANAGER_API_KEY → manager");
  ok(resolveKeyRole("CK", keyEnv)?.role === "cashier", "CASHIER_API_KEY → cashier");
  ok(resolveKeyRole("LEG", keyEnv)?.viaLegacyKey === true, "legacy API_KEY flagged");
  ok(resolveKeyRole("nope", keyEnv) === null, "unknown key → null");

  console.log("\n5) resolvePasswordRole verifies against D1 hashes (PBKDF2 compatible)");
  ok((await resolvePasswordRole(env, MANAGER_PASSWORD)) === "manager", "manager password → manager");
  ok((await resolvePasswordRole(env, CASHIER_PASSWORD)) === "cashier", "cashier password → cashier");
  ok((await resolvePasswordRole(env, "wrong")) === null, "wrong password → null");

  console.log("\n6) POST /v1/session enforces credentials");
  const noCred = await handleSessionRoutes(
    new Request("https://api.engaz.tech/v1/session", { method: "POST", body: "{}" }),
    env,
    CORS
  );
  ok(noCred?.status === 401, "no credential → 401 (no anonymous session)");

  const wrong = await handleSessionRoutes(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      body: JSON.stringify({ password: "nope" }),
    }),
    env,
    CORS
  );
  ok(wrong?.status === 401, "wrong password → 401");

  const good = await handleSessionRoutes(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      body: JSON.stringify({ password: MANAGER_PASSWORD }),
    }),
    env,
    CORS
  );
  ok(good?.status === 200, "manager password → 200");
  const setCookie = good!.headers.get("Set-Cookie") || "";
  ok(setCookie.includes(SESSION_COOKIE) && /HttpOnly/i.test(setCookie), "mint sets HttpOnly session cookie");
  const body = await good!.json();
  ok(body.role === "manager", "mint response reports role=manager");

  console.log("\n7) minted cookie authenticates and carries the role");
  const cookieVal = setCookie.split(";")[0].split("=").slice(1).join("=");
  const authed = await authenticate(
    new Request("https://api.engaz.tech/v1/x", { headers: { Cookie: `${SESSION_COOKIE}=${cookieVal}` } }),
    env
  );
  ok(authed?.role === "manager", "authenticate() returns role from cookie");
  ok(
    (await authenticate(new Request("https://api.engaz.tech/v1/x"), env)) === null,
    "no cookie → null (401 upstream)"
  );

  console.log("\n8) mint fails closed without SESSION_SECRET (503)");
  const noSecret = await handleSessionRoutes(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      body: JSON.stringify({ password: MANAGER_PASSWORD }),
    }),
    { DB } as any,
    CORS
  );
  ok(noSecret?.status === 503, "no SESSION_SECRET → 503");

  console.log(`\n✅ auth.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ auth.test FAILED:", err);
  process.exit(1);
});
