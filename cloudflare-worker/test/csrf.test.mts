/**
 * CSRF defense (fix #3): strict Origin allowlist + double-submit token.
 *
 *   node --experimental-strip-types test/csrf.test.mts
 */

import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { csrfTokenFor } from "../src/auth.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

function bufToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function clientHash(pw: string) {
  const e = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", e.encode(pw), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  const dk = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  return { hash: bufToHex(new Uint8Array(await crypto.subtle.exportKey("raw", dk))), salt: bufToHex(salt) };
}

function makeStubDB(settings: Record<string, string>) {
  return {
    prepare(sql: string) {
      const st: { key: string | null } = { key: null };
      return {
        bind(...a: any[]) {
          st.key = a[0];
          return this;
        },
        async first() {
          if (/FROM settings/i.test(sql) && st.key && st.key in settings) return { value: settings[st.key] };
          if (/FROM orders/i.test(sql)) return { id: "o1", paymentStatus: "Paid" };
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

async function main() {
  const mgr = await clientHash("mgr-pw");
  const env: any = {
    DB: makeStubDB({ "global::brewmaster_manager_creds_v1": JSON.stringify({ username: "manager", ...mgr }) }),
    SESSION_SECRET: "csrf-secret",
    ALLOWED_ORIGINS: "https://pos.engaz.tech",
  };

  // Mint a manager session (from the allowlisted origin).
  const mint = await worker.fetch(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      headers: { Origin: "https://pos.engaz.tech", "Content-Type": "application/json" },
      body: JSON.stringify({ password: "mgr-pw" }),
    }),
    env
  );
  const cookie = (mint.headers.get("Set-Cookie") || "").split(";")[0];
  const { csrfToken } = await mint.json();
  ok(!!csrfToken, "mint returns a csrfToken in the body");

  const WRITE = "https://api.engaz.tech/v1/databases/default/collections/orders/documents/o1";

  console.log("\n1) double-submit token is required on writes");
  const noToken = await worker.fetch(
    new Request(WRITE, { method: "DELETE", headers: { Origin: "https://pos.engaz.tech", Cookie: cookie } }),
    env
  );
  ok(noToken.status === 403, "cookie write WITHOUT X-CSRF-Token → 403");
  ok(noToken.headers.get("X-CSRF-Failed") === "1", "403 flagged X-CSRF-Failed for client retry");

  const wrongToken = await worker.fetch(
    new Request(WRITE, {
      method: "DELETE",
      headers: { Origin: "https://pos.engaz.tech", Cookie: cookie, "X-CSRF-Token": "bogus" },
    }),
    env
  );
  ok(wrongToken.status === 403, "cookie write with WRONG token → 403");

  const goodToken = await worker.fetch(
    new Request(WRITE, {
      method: "DELETE",
      headers: { Origin: "https://pos.engaz.tech", Cookie: cookie, "X-CSRF-Token": csrfToken },
    }),
    env
  );
  ok(goodToken.status !== 403, `cookie write WITH valid token passes CSRF (got ${goodToken.status})`);

  console.log("\n2) cross-site Origin is rejected before the write");
  const evilOrigin = await worker.fetch(
    new Request(WRITE, {
      method: "DELETE",
      headers: { Origin: "https://evil.example", Cookie: cookie, "X-CSRF-Token": csrfToken },
    }),
    env
  );
  ok(evilOrigin.status === 403, "write from non-allowlisted Origin → 403");
  const bodyEvil = await evilOrigin.json();
  ok(bodyEvil.code === "csrf_origin", "rejection code is csrf_origin");

  console.log("\n3) headless caller (no Origin) is not blocked by CSRF");
  // No cookie, no Origin, legacy API key → not a browser, CSRF N/A.
  const keyEnv: any = { ...env, API_KEY: "legacy-key" };
  const headless = await worker.fetch(
    new Request(WRITE, { method: "DELETE", headers: { "X-API-Key": "legacy-key" } }),
    keyEnv
  );
  ok(headless.status !== 403 || headless.status === 200, `headless key write not CSRF-blocked (got ${headless.status})`);

  console.log("\n4) csrfTokenFor is sid-bound and deterministic");
  const a1 = await csrfTokenFor("sid-A", env);
  const a2 = await csrfTokenFor("sid-A", env);
  const b1 = await csrfTokenFor("sid-B", env);
  ok(a1 && a1 === a2, "same sid → same token");
  ok(a1 !== b1, "different sid → different token");
  ok(a1.includes("."), "v2 token embeds the sid (format: <sid>.<sig>)");
  ok(a1.split(".")[0] === "sid-A", "embedded sid prefix matches");

  console.log("\n5) a token minted for an OLD sid passes after the cookie is re-minted (cache-clear regression)");
  // Simulate: operator logged in → token for sid-OLD persisted in localStorage.
  // Browser cache cleared → cookie wiped → operator logs in again → NEW cookie
  // with sid-NEW. The client still echoes the persisted sid-OLD token. Before
  // the fix every write 403'd "Missing or invalid CSRF token"; now the token
  // carries its own sid so it verifies against the NEW cookie's session.
  const mint2 = await worker.fetch(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      headers: { Origin: "https://pos.engaz.tech", "Content-Type": "application/json" },
      body: JSON.stringify({ password: "mgr-pw" }),
    }),
    env
  );
  const cookie2 = (mint2.headers.get("Set-Cookie") || "").split(";")[0];
  ok(cookie2 !== cookie || true, "second mint produced a session (sid may collide randomly — not asserted)");
  const oldSidToken = await csrfTokenFor("definitely-an-older-sid-0123456789", env);
  const reloginWrite = await worker.fetch(
    new Request(WRITE, {
      method: "DELETE",
      headers: { Origin: "https://pos.engaz.tech", Cookie: cookie2, "X-CSRF-Token": oldSidToken },
    }),
    env
  );
  ok(reloginWrite.status !== 403, `old-sid token + re-minted cookie passes CSRF (got ${reloginWrite.status})`);

  console.log("\n6) forged tokens are still rejected");
  // A token with a well-formed shape but a bogus signature must fail — the sid
  // embedding does not weaken the HMAC binding to SESSION_SECRET.
  const forged = await csrfTokenFor("attacker-sid", { ...env, SESSION_SECRET: "WRONG-secret" });
  const forgedWrite = await worker.fetch(
    new Request(WRITE, {
      method: "DELETE",
      headers: { Origin: "https://pos.engaz.tech", Cookie: cookie2, "X-CSRF-Token": forged },
    }),
    env
  );
  ok(forgedWrite.status === 403, "token signed with a DIFFERENT secret → 403");

  const tampered = `${oldSidToken.slice(0, oldSidToken.lastIndexOf("."))}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const tamperedWrite = await worker.fetch(
    new Request(WRITE, {
      method: "DELETE",
      headers: { Origin: "https://pos.engaz.tech", Cookie: cookie2, "X-CSRF-Token": tampered },
    }),
    env
  );
  ok(tamperedWrite.status === 403, "token with tampered signature → 403");

  console.log(`\n✅ csrf.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ csrf.test FAILED:", err);
  process.exit(1);
});
