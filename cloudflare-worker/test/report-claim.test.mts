/**
 * Cross-device daily-report claim lock (POST /api/report/claim).
 *
 * Only ONE manager device may send the automatic daily Telegram report per
 * business day. The claim is an atomic unique INSERT keyed by day; the first
 * manager device wins, later claimants get 409, and a cashier is denied 403.
 *
 *   node --experimental-strip-types test/report-claim.test.mts
 */

import assert from "node:assert/strict";
import worker from "../src/index.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

function bufToHex(buf) {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function clientHash(pw) {
  const e = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", e.encode(pw), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  const dk = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  return { hash: bufToHex(new Uint8Array(await crypto.subtle.exportKey("raw", dk))), salt: bufToHex(salt) };
}

/** Minimal D1 stub: settings rows readable; INSERT enforces the id PRIMARY KEY. */
function makeStubDB(creds) {
  const claimedIds = new Set();
  const settingsRows = Object.entries(creds).map(([key, value]) => ({
    id: `global::${key}`,
    key,
    value,
    updated_at: "2026-01-01T00:00:00Z",
  }));
  const inserted = [];
  return {
    _inserted: inserted,
    prepare(sql) {
      const bound = [];
      return {
        bind(...a) {
          bound.push(...a);
          return this;
        },
        async first() {
          if (/FROM settings/i.test(sql)) {
            if (bound[0] && bound[0] in creds) return { value: creds[bound[0]] };
            return settingsRows.find((r) => r.id === bound[0]) || null;
          }
          return null;
        },
        async all() {
          if (/FROM settings/i.test(sql)) return { results: settingsRows };
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO settings/i.test(sql)) {
            const id = bound[0];
            if (claimedIds.has(id)) {
              throw new Error("UNIQUE constraint failed: settings.id");
            }
            claimedIds.add(id);
            inserted.push({ id, key: bound[1] });
            return { success: true };
          }
          return { success: true };
        },
      };
    },
  };
}

async function mintCookie(env, password) {
  const res = await worker.fetch(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      headers: { Origin: "https://pos.engaz.tech", "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
    env
  );
  const setCookie = res.headers.get("Set-Cookie") || "";
  const body = await res.json();
  return { cookie: setCookie.split(";")[0], csrf: body.csrfToken };
}

async function main() {
  console.log("\n1) report claim: first manager wins, second gets 409, cashier 403");
  const mgr = await clientHash("mgr-pw");
  const csh = await clientHash("csh-pw");
  const env = {
    DB: makeStubDB({
      brewmaster_manager_creds_v1: JSON.stringify({ username: "manager", ...mgr }),
      brewmaster_admin_creds_v2: JSON.stringify({ username: "admin", ...csh }),
    }),
    SESSION_SECRET: "claim-secret",
    ALLOWED_ORIGINS: "https://pos.engaz.tech",
  };

  const mgrSession = await mintCookie(env, "mgr-pw");
  const cshSession = await mintCookie(env, "csh-pw");
  const CLAIM = "https://api.engaz.tech/api/report/claim";
  const H = (s) => ({
    Origin: "https://pos.engaz.tech",
    Cookie: s.cookie,
    "X-CSRF-Token": s.csrf,
    "Content-Type": "application/json",
  });
  const dayBody = JSON.stringify({ dayKey: "2026-07-28" });

  // Cashier is denied outright.
  const cashierClaim = await worker.fetch(new Request(CLAIM, { method: "POST", headers: H(cshSession), body: dayBody }), env);
  ok(cashierClaim.status === 403, `cashier claim → 403 (got ${cashierClaim.status})`);

  // First manager device claims the day.
  const first = await worker.fetch(new Request(CLAIM, { method: "POST", headers: H(mgrSession), body: dayBody }), env);
  ok(first.status === 200, `first manager claim → 200 (got ${first.status})`);
  const firstBody = await first.json();
  ok(firstBody.claimed === true, "first claim returns claimed:true");

  // A second manager device on the SAME day loses with 409.
  const second = await worker.fetch(new Request(CLAIM, { method: "POST", headers: H(mgrSession), body: dayBody }), env);
  ok(second.status === 409, `second manager claim same day → 409 (got ${second.status})`);
  const secondBody = await second.json();
  ok(secondBody.claimed === false, "second claim returns claimed:false");
  ok(secondBody.reason === "already_claimed", "second claim reason is already_claimed");

  // A DIFFERENT day is a fresh lock and can be claimed again.
  const nextDay = await worker.fetch(
    new Request(CLAIM, { method: "POST", headers: H(mgrSession), body: JSON.stringify({ dayKey: "2026-07-29" }) }),
    env
  );
  ok(nextDay.status === 200, `next-day claim → 200 (got ${nextDay.status})`);

  // A malformed dayKey is rejected.
  const bad = await worker.fetch(
    new Request(CLAIM, { method: "POST", headers: H(mgrSession), body: JSON.stringify({ dayKey: "tomorrow" }) }),
    env
  );
  ok(bad.status === 400, `bad dayKey → 400 (got ${bad.status})`);

  console.log(`\n✅ report-claim.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ report-claim.test FAILED:", err);
  process.exit(1);
});
