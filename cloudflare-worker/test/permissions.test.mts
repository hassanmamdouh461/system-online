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

  // Deleting an invoice is forbidden for EVERY role — a refund is the only void.
  ok(!can({ role: "manager", table: "orders", method: "DELETE" }).allowed, "manager DELETE order → denied");
  ok(!can({ role: "cashier", table: "orders", method: "DELETE" }).allowed, "cashier DELETE order → denied");
  ok(can({ role: "cashier", table: "orders", method: "GET" }).allowed, "cashier GET → allowed");
  ok(
    !can({
      role: "manager",
      table: "orders",
      method: "PATCH",
      docId: "o1",
      submitted: { id: "o1", deletedAt: "2026-01-01T00:00:00Z" },
      current: { id: "o1", deletedAt: null, paymentStatus: "Paid" },
    }).allowed,
    "manager soft-delete of an order → denied"
  );

  // A cashier refunds from the till: no escalation PIN, no manager session.
  const refundAttempt = {
    role: "cashier" as const,
    table: "orders",
    method: "PATCH" as const,
    docId: "o1",
    submitted: { id: "o1", refundedAt: "2026-01-01T00:00:00Z", refundReason: "x", paymentStatus: "Refunded" },
    current: { id: "o1", refundedAt: null, refundReason: null, paymentStatus: "Paid" },
  };
  ok(can(refundAttempt).allowed, "cashier refund with no PIN → allowed");
  ok(can({ ...refundAttempt, refundEscalated: true }).allowed, "cashier refund with a legacy PIN header → allowed");
  ok(
    !can({
      role: "cashier",
      table: "orders",
      method: "PATCH",
      docId: "o1",
      submitted: { id: "o1", deletedAt: "2026-01-01T00:00:00Z" },
      current: { id: "o1", deletedAt: null, paymentStatus: "Paid" },
    }).allowed,
    "cashier soft-delete of an order → denied"
  );

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

  // Worker-owned settings rows: refused for EVERY role, on every mutating
  // method. Regression for the invoice-counter reset — the guard used to sit
  // below `if (role === "manager") return ALLOW` AND matched on the key name
  // while the real rows are day-scoped ids (`order_seq::<day>`), so a manager
  // session could roll the day's ticket counter back to zero through the
  // ordinary settings sync path and re-issue printed invoice numbers.
  for (const role of ["manager", "cashier"] as const) {
    for (const docId of ["order_seq::2026-08-04", "report_claim::2026-08-04"]) {
      for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
        const d = can({
          role,
          table: "settings",
          method,
          docId,
          submitted: { value: "0" },
          current: null,
        });
        ok(!d.allowed, `${role} ${method} ${docId} → denied`);
        ok(
          d.code === "worker_owned_setting",
          `${role} ${method} ${docId} → worker_owned_setting (got ${d.code})`
        );
      }
    }
    // Legacy id shape addressing the same counter by key name.
    ok(
      !can({
        role,
        table: "settings",
        method: "POST",
        docId: "global::brewmaster_order_seq",
        submitted: { value: "0" },
        current: null,
      }).allowed,
      `${role} POST global::brewmaster_order_seq → denied`
    );
    // Reads must stay open — hydration pulls the settings table wholesale.
    ok(
      can({ role, table: "settings", method: "GET", docId: "order_seq::2026-08-04" }).allowed,
      `${role} GET order_seq row → allowed`
    );
  }
  // The guard must not spill onto ordinary settings a manager legitimately writes.
  ok(
    can({
      role: "manager",
      table: "settings",
      method: "POST",
      docId: "global::brewmaster_tax_rate",
      submitted: { value: "14" },
      current: null,
    }).allowed,
    "manager writing an ordinary setting → still allowed"
  );

  // Blocker 1 regression: a SPOOFED submitted.key must never launder a write to
  // a sensitive document. Before the fix, settingKeyFrom read submitted.key
  // first, so claiming "brewmaster_language" (cashier-allowed) on the
  // manager-creds docId authorized the write. The key now comes from the docId
  // exclusively and any disagreeing submitted.key is denied outright — for the
  // cashier AND for the manager (the mismatch guard precedes role checks).
  const spoofedManager = can({
    role: "cashier",
    table: "settings",
    method: "PATCH",
    docId: "global::brewmaster_manager_creds_v1",
    submitted: { key: "brewmaster_language", value: "en" },
    current: { key: "brewmaster_manager_creds_v1" },
  });
  ok(!spoofedManager.allowed, "cashier spoofed key on manager-creds docId → denied");
  ok(
    spoofedManager.code === "setting_key_mismatch" ||
      spoofedManager.code === "cashier_sensitive_setting",
    `spoofed key surfaces a fail-closed code (got ${spoofedManager.code})`
  );
  ok(
    !can({
      role: "manager",
      table: "settings",
      method: "PATCH",
      docId: "global::brewmaster_manager_creds_v1",
      submitted: { key: "brewmaster_language", value: "en" },
      current: { key: "brewmaster_manager_creds_v1" },
    }).allowed,
    "even a MANAGER payload with a disagreeing submitted.key → denied"
  );
  // Sanity: a body that echoes the CORRECT key (or omits it) stays allowed —
  // whole-row sync clients resend stored fields, so an honest resend must pass.
  ok(
    can({
      role: "manager",
      table: "settings",
      method: "PATCH",
      docId: "global::brewmaster_manager_creds_v1",
      submitted: { key: "brewmaster_manager_creds_v1", value: "{}" },
      current: { key: "brewmaster_manager_creds_v1" },
    }).allowed,
    "manager write with matching key → allowed"
  );
  ok(
    can({
      role: "cashier",
      table: "settings",
      method: "PATCH",
      docId: "global::brewmaster_language",
      submitted: { value: "ar" },
      current: { key: "brewmaster_language" },
    }).allowed,
    "cashier allowed-key write without a key field in the body → still allowed"
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

  // Soft-delete on customers/companies is manager-only. The sync queue sends
  // `action: "update"` (→ method PATCH), so a cashier must not be able to flip
  // `deleted_at` on an existing row via a POST/PATCH upsert.
  ok(
    !can({
      role: "cashier",
      table: "customers",
      method: "PATCH",
      docId: "c1",
      submitted: { id: "c1", name: "x", deleted_at: "2026-01-01T00:00:00Z" },
      current: { id: "c1", name: "x", deleted_at: null },
    }).allowed,
    "cashier soft-deleting a customer → denied"
  );
  ok(
    !can({
      role: "cashier",
      table: "companies",
      method: "PATCH",
      docId: "co1",
      submitted: { id: "co1", deleted_at: "2026-01-01T00:00:00Z" },
      current: { id: "co1", deleted_at: null },
    }).allowed,
    "cashier soft-deleting a company → denied"
  );
  ok(
    can({
      role: "cashier",
      table: "customers",
      method: "PATCH",
      docId: "c2",
      submitted: { id: "c2", name: "new walk-in" },
      current: null,
    }).allowed,
    "cashier creating a customer → allowed"
  );
  ok(
    can({
      role: "cashier",
      table: "companies",
      method: "PATCH",
      docId: "co2",
      submitted: { id: "co2", name: "Acme", notes: "updated" },
      current: { id: "co2", name: "Acme", notes: null, deleted_at: null },
    }).allowed,
    "cashier updating a company without touching deleted_at → allowed"
  );
  ok(
    can({
      role: "manager",
      table: "customers",
      method: "PATCH",
      docId: "c1",
      submitted: { id: "c1", deleted_at: "2026-01-01T00:00:00Z" },
      current: { id: "c1", deleted_at: null },
    }).allowed,
    "manager soft-deleting a customer → allowed"
  );
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
  ok(managerDelete.status === 403, `manager DELETE order → 403, invoices are never deleted (got ${managerDelete.status})`);

  // Blocker 1, end-to-end: a cashier PATCH to the manager-creds document that
  // CLAIMS the cashier-allowed key "brewmaster_language" in the body must be
  // rejected with 403 — before the fix this authorized and landed the write.
  const SPOOF =
    "https://api.engaz.tech/v1/databases/default/collections/settings/documents/global::brewmaster_manager_creds_v1";
  const spoofed = await worker.fetch(
    new Request(SPOOF, {
      method: "PATCH",
      headers: { ...H(cshSession), "Content-Type": "application/json" },
      body: JSON.stringify({ data: { key: "brewmaster_language", value: "en" } }),
    }),
    env
  );
  ok(spoofed.status === 403, `cashier PATCH manager-creds with spoofed key → 403 (got ${spoofed.status})`);
  ok((spoofed.headers.get("X-Auth-Role") || "") === "cashier", "spoof 403 reports X-Auth-Role: cashier");
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
