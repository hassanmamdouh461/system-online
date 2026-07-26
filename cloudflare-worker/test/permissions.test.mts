/**
 * Role enforcement (fix #2): permissions.ts decision matrix + end-to-end proof
 * that the cookie role actually gates writes in src/index.ts.
 *
 *   node --experimental-strip-types test/permissions.test.mts
 */

import assert from "node:assert/strict";
import {
  can,
  changedFields,
  valuesEqual,
  isOrderSettled,
  canReadSettingKey,
  canReadTable,
} from "../src/permissions.ts";
import worker from "../src/index.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

// ─── Pure decision matrix ──────────────────────────────────────────────────────
function pureMatrix() {
  console.log("\n1) permissions.can() decision matrix");

  ok(can({ role: "manager", table: "orders", method: "DELETE" }).allowed, "manager may DELETE");
  ok(!can({ role: "cashier", table: "orders", method: "DELETE" }).allowed, "cashier DELETE → denied");
  ok(can({ role: "cashier", table: "orders", method: "GET" }).allowed, "cashier GET → allowed");

  // Refund fields are frozen for a cashier unless escalated.
  const refundAttempt = {
    role: "cashier" as const,
    table: "orders",
    method: "PATCH" as const,
    docId: "o1",
    submitted: { id: "o1", refundedAt: "2026-01-01T00:00:00Z", refundReason: "x" },
    current: { id: "o1", refundedAt: null, refundReason: null, paymentStatus: "Paid" },
  };
  ok(!can(refundAttempt).allowed, "cashier refund without escalation → denied");
  ok(can({ ...refundAttempt, refundEscalated: true }).allowed, "cashier refund WITH escalation → allowed");

  // Whole-object resend of an unchanged frozen field must NOT be denied.
  ok(
    can({
      role: "cashier",
      table: "inventory",
      method: "PATCH",
      docId: "i1",
      submitted: { id: "i1", stock: 5, costPerUnit: 2 },
      current: { id: "i1", stock: 9, costPerUnit: 2 },
    }).allowed,
    "cashier stock move with unchanged costPerUnit → allowed"
  );
  ok(
    !can({
      role: "cashier",
      table: "inventory",
      method: "PATCH",
      docId: "i1",
      submitted: { id: "i1", stock: 5, costPerUnit: 99 },
      current: { id: "i1", stock: 9, costPerUnit: 2 },
    }).allowed,
    "cashier changing costPerUnit → denied"
  );

  // Privilege-escalation via settings is closed.
  ok(
    !can({
      role: "cashier",
      table: "settings",
      method: "PATCH",
      docId: "global::brewmaster_manager_creds_v1",
      submitted: { id: "global::brewmaster_manager_creds_v1", value: "{}" },
      current: null,
    }).allowed,
    "cashier writing manager creds → denied"
  );

  // Sanity on helpers.
  ok(valuesEqual("12.5", 12.5), "valuesEqual normalizes number vs string");
  ok(changedFields({ id: "x", a: 1 }, { id: "x", a: 1 }).length === 0, "no-op resend → no changes");
  ok(isOrderSettled({ paymentStatus: "Paid" }), "Paid order is settled");

  // Read authorization: cashier reads are filtered, manager reads everything.
  ok(canReadSettingKey("manager", "brewmaster_manager_creds_v1"), "manager may READ manager creds");
  ok(!canReadSettingKey("cashier", "brewmaster_manager_creds_v1"), "cashier READ manager creds → denied");
  ok(!canReadSettingKey("cashier", "brewmaster_admin_pin"), "cashier READ refund PIN → denied");
  ok(!canReadSettingKey("cashier", "brewmaster_telegram_bot_token"), "cashier READ telegram token → denied");
  ok(canReadSettingKey("cashier", "brewmaster_admin_creds_v2"), "cashier may READ its OWN creds");
  ok(canReadSettingKey("cashier", "brewmaster_tax_rate"), "cashier may READ tax rate (operational)");
  ok(canReadSettingKey("cashier", "brewmaster_store_config"), "cashier may READ store config (receipts)");
  ok(canReadTable("cashier", "settings"), "cashier may read the settings table (filtered per-key)");
  ok(!canReadTable("cashier", "snapshots"), "cashier READ snapshots table → denied (bundles secrets)");
  ok(canReadTable("manager", "snapshots"), "manager may read snapshots");
}

// ─── Client-compatible PBKDF2 for minting real cookies ─────────────────────────
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

function makeStubDB(settings: Record<string, string>, orderRow: any, snapshots: any[] = []) {
  // Materialize the settings map as D1-shaped rows for list/single reads.
  const settingsRows = Object.entries(settings).map(([key, value]) => ({
    id: `global::${key}`,
    key,
    value,
    updated_at: "2026-01-01T00:00:00Z",
  }));
  return {
    prepare(sql: string) {
      const st: { key: string | null } = { key: null };
      return {
        bind(...a: any[]) {
          st.key = a[0];
          return this;
        },
        async first() {
          if (/FROM settings/i.test(sql)) {
            // auth.ts readCredsRecord binds the bare key; the REST single-doc GET
            // binds the `global::<key>` document id.
            if (st.key && st.key in settings) return { value: settings[st.key] };
            return settingsRows.find((r) => r.id === st.key) || null;
          }
          if (/FROM orders/i.test(sql)) return orderRow;
          if (/FROM snapshots/i.test(sql)) return snapshots.find((s) => s.id === st.key) || null;
          return null;
        },
        async all() {
          if (/FROM settings/i.test(sql)) return { results: settingsRows };
          if (/FROM snapshots/i.test(sql)) return { results: snapshots };
          if (/FROM orders/i.test(sql)) return { results: orderRow ? [orderRow] : [] };
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
}

async function mintCookie(env: any, password: string): Promise<{ cookie: string; csrf: string }> {
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

async function integration() {
  console.log("\n2) end-to-end: the cookie role gates writes");
  const mgr = await clientHash("mgr-pw");
  const csh = await clientHash("csh-pw");
  const env: any = {
    DB: makeStubDB(
      {
        brewmaster_manager_creds_v1: JSON.stringify({ username: "manager", ...mgr }),
        brewmaster_admin_creds_v2: JSON.stringify({ username: "admin", ...csh }),
      },
      { id: "o1", paymentStatus: "Paid", refundedAt: null }
    ),
    SESSION_SECRET: "perm-secret",
    ALLOWED_ORIGINS: "https://pos.engaz.tech",
  };

  const mgrSession = await mintCookie(env, "mgr-pw");
  const cshSession = await mintCookie(env, "csh-pw");
  const DEL = "https://api.engaz.tech/v1/databases/default/collections/orders/documents/o1";
  // Writes carry Origin + cookie + the CSRF double-submit token.
  const H = (s: { cookie: string; csrf: string }) => ({
    Origin: "https://pos.engaz.tech",
    Cookie: s.cookie,
    "X-CSRF-Token": s.csrf,
  });

  const cashierDelete = await worker.fetch(new Request(DEL, { method: "DELETE", headers: H(cshSession) }), env);
  ok(cashierDelete.status === 403, `cashier DELETE order → 403 (got ${cashierDelete.status})`);
  ok((cashierDelete.headers.get("X-Auth-Role") || "") === "cashier", "403 reports X-Auth-Role: cashier");

  const managerDelete = await worker.fetch(new Request(DEL, { method: "DELETE", headers: H(mgrSession) }), env);
  ok(managerDelete.status === 200, `manager DELETE order → 200 (got ${managerDelete.status})`);
}

async function readFilter() {
  console.log("\n3) end-to-end: cashier GET responses strip sensitive settings + snapshots");
  const mgr = await clientHash("mgr-pw");
  const csh = await clientHash("csh-pw");
  const env: any = {
    DB: makeStubDB(
      {
        // sensitive — must be invisible to a cashier
        brewmaster_manager_creds_v1: JSON.stringify({ username: "manager", ...mgr }),
        brewmaster_admin_pin: "pinhash$aa$bb",
        brewmaster_telegram_bot_token: "123456:REAL-SECRET-BOT-TOKEN",
        brewmaster_telegram_chat_id: "-1001234567890",
        // readable — cashier needs these
        brewmaster_admin_creds_v2: JSON.stringify({ username: "admin", ...csh }),
        brewmaster_tax_rate: "0.14",
        brewmaster_store_config: JSON.stringify({ storeName: "Cafe" }),
      },
      { id: "o1", paymentStatus: "Paid", refundedAt: null },
      // one snapshot whose payload bundles the whole settings blob (incl. secrets)
      [{ id: "snap_1", branch_id: "main_branch", kind: "auto", created_at: "2026-01-02T00:00:00Z", payload: JSON.stringify({ settings: { brewmaster_telegram_bot_token: "123456:REAL-SECRET-BOT-TOKEN" } }) }]
    ),
    SESSION_SECRET: "read-secret",
    ALLOWED_ORIGINS: "https://pos.engaz.tech",
  };

  const mgrSession = await mintCookie(env, "mgr-pw");
  const cshSession = await mintCookie(env, "csh-pw");
  const SETTINGS = "https://api.engaz.tech/v1/databases/default/collections/settings/documents";
  const SNAPSHOTS = "https://api.engaz.tech/v1/databases/default/collections/snapshots/documents";

  const getList = async (url: string, cookie: string) => {
    const res = await worker.fetch(new Request(url, { method: "GET", headers: { Cookie: cookie } }), env);
    const body = await res.json();
    return { status: res.status, keys: (body.documents || []).map((d: any) => d.key), body };
  };

  // Cashier: sensitive keys stripped, operational keys kept.
  const cashierSettings = await getList(SETTINGS, cshSession.cookie);
  const hidden = ["brewmaster_manager_creds_v1", "brewmaster_admin_pin", "brewmaster_telegram_bot_token", "brewmaster_telegram_chat_id"];
  ok(
    hidden.every((k) => !cashierSettings.keys.includes(k)),
    `cashier settings list hides secrets (got: ${cashierSettings.keys.join(", ")})`
  );
  ok(cashierSettings.keys.includes("brewmaster_admin_creds_v2"), "cashier settings list keeps its own creds");
  ok(cashierSettings.keys.includes("brewmaster_tax_rate"), "cashier settings list keeps tax rate");

  // Manager: sees everything.
  const managerSettings = await getList(SETTINGS, mgrSession.cookie);
  ok(
    hidden.every((k) => managerSettings.keys.includes(k)),
    "manager settings list returns the sensitive keys"
  );

  // Cashier single-doc read of a secret → 404 (indistinguishable from absent).
  const cashierCreds = await worker.fetch(
    new Request(`${SETTINGS}/global::brewmaster_manager_creds_v1`, { method: "GET", headers: { Cookie: cshSession.cookie } }),
    env
  );
  ok(cashierCreds.status === 404, `cashier GET manager-creds doc → 404 (got ${cashierCreds.status})`);
  const cashierTax = await worker.fetch(
    new Request(`${SETTINGS}/global::brewmaster_tax_rate`, { method: "GET", headers: { Cookie: cshSession.cookie } }),
    env
  );
  ok(cashierTax.status === 200, `cashier GET tax-rate doc → 200 (got ${cashierTax.status})`);

  // Snapshots: the secret-bundling backdoor is closed for cashiers, open for managers.
  const cashierSnaps = await getList(SNAPSHOTS, cshSession.cookie);
  ok(cashierSnaps.body.documents.length === 0, `cashier snapshots list → empty (got ${cashierSnaps.body.documents.length})`);
  const managerSnaps = await getList(SNAPSHOTS, mgrSession.cookie);
  ok(managerSnaps.body.documents.length === 1, `manager snapshots list → 1 (got ${managerSnaps.body.documents.length})`);
}

async function main() {
  pureMatrix();
  await integration();
  await readFilter();
  console.log(`\n✅ permissions.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ permissions.test FAILED:", err);
  process.exit(1);
});
