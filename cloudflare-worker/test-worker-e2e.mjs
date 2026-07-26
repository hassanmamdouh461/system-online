/**
 * End-to-end worker test.
 *
 * Exercises the REAL exported fetch handler from src/index.ts against a fake D1
 * binding, so it verifies the wiring — role resolution, the five authorize()
 * call sites, status codes, headers — not just the pure matrix in
 * test-permissions.mjs.
 *
 * Run: node --experimental-strip-types test-worker-e2e.mjs
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test-only module shim.
 *
 * `src/index.ts` imports `./permissions` without a file extension, which is the
 * standard Workers/esbuild convention (Wrangler infers `.ts`). Node's ESM
 * resolver requires an explicit extension, so loading index.ts directly fails
 * here even though it bundles and deploys correctly.
 *
 * Rather than contort the production import to suit the test runner, both files
 * are copied to a temp dir with the specifier rewritten to `.mts`. Production
 * code stays idiomatic; only the harness adapts.
 */
const shimDir = mkdtempSync(join(tmpdir(), "worker-e2e-"));
writeFileSync(
  join(shimDir, "permissions.mts"),
  readFileSync(new URL("./src/permissions.ts", import.meta.url), "utf8")
);
writeFileSync(
  join(shimDir, "index.mts"),
  readFileSync(new URL("./src/index.ts", import.meta.url), "utf8").replace(
    /from\s+"\.\/permissions"/g,
    'from "./permissions.mts"'
  )
);

const worker = (await import(join(shimDir, "index.mts"))).default;

// ─── Minimal in-memory D1 stub ───────────────────────────────────────────────
// Only the shapes the worker actually uses: SELECT * WHERE id = ?, INSERT ...
// ON CONFLICT, UPDATE ... WHERE id, DELETE ... WHERE id.
function makeDB(seed = {}) {
  const tables = JSON.parse(JSON.stringify(seed));
  const deletes = [];
  const writes = [];

  function tableOf(sql) {
    const m =
      sql.match(/FROM\s+(\w+)/i) ||
      sql.match(/INTO\s+(\w+)/i) ||
      sql.match(/UPDATE\s+(\w+)/i);
    return m ? m[1] : null;
  }

  return {
    _tables: tables,
    _deletes: deletes,
    _writes: writes,
    prepare(sql) {
      let bound = [];
      const stmt = {
        bind(...args) {
          bound = args;
          return stmt;
        },
        async first() {
          const t = tableOf(sql);
          const rows = tables[t] || [];
          return rows.find((r) => String(r.id) === String(bound[0])) || null;
        },
        async all() {
          const t = tableOf(sql);
          return { results: tables[t] || [] };
        },
        async run() {
          const t = tableOf(sql);
          if (/^\s*DELETE/i.test(sql)) {
            deletes.push({ table: t, id: bound[0] });
            tables[t] = (tables[t] || []).filter(
              (r) => String(r.id) !== String(bound[0])
            );
          } else {
            writes.push({ table: t, sql, bound });
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

const MGR = "mgr_key_aaaaaaaaaaaaaaaa";
const CSH = "csh_key_bbbbbbbbbbbbbbbb";
const PIN = "4321";

function makeEnv(db) {
  return {
    DB: db,
    MANAGER_API_KEY: MGR,
    CASHIER_API_KEY: CSH,
    REFUND_PIN: PIN,
    ALLOWED_ORIGINS: "https://pos.engaz.tech",
  };
}

const SEED = {
  orders: [
    {
      id: "order_paid",
      orderNumber: "5",
      totalAmount: 100,
      grandTotal: 110,
      taxRate: 0.1,
      taxAmount: 10,
      paymentStatus: "Paid",
      refundedAt: null,
      refundReason: null,
      deletedAt: null,
      items: "[]",
    },
    {
      id: "order_open",
      orderNumber: "6",
      totalAmount: 50,
      paymentStatus: "Unpaid",
      refundedAt: null,
      items: "[]",
    },
  ],
  inventory: [
    { id: "inv_milk", name: "Milk", unit: "L", stock: 10, minStock: 5, costPerUnit: 25 },
  ],
  settings: [
    {
      id: "global::brewmaster_manager_creds_v1",
      key: "brewmaster_manager_creds_v1",
      value: "real-hash",
      updated_at: "2026-07-01T00:00:00Z",
    },
    {
      // Needed because the PATCH path re-SELECTs the row and 404s when absent;
      // the stub's UPDATE does not synthesize rows.
      id: "global::brewmaster_language",
      key: "brewmaster_language",
      value: "ar",
      updated_at: "2026-07-01T00:00:00Z",
    },
  ],
  menu_items: [{ id: "m1", name: "Latte", price: 50, available: 1 }],
};

let passed = 0;
let failed = 0;
const failures = [];

async function call({ key, method, path, body, pin }) {
  const db = makeDB(SEED);
  const headers = { Origin: "https://pos.engaz.tech" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  if (pin) headers["X-Refund-PIN"] = pin;
  if (body) headers["Content-Type"] = "application/json";

  const res = await worker.fetch(
    new Request(`https://w.dev${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    makeEnv(db)
  );
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json, db };
}

async function expectStatus(name, opts, expected) {
  const { res, json, db } = await call(opts);
  const ok = res.status === expected;
  if (ok) passed++;
  else {
    failed++;
    failures.push(
      `${name}\n      expected HTTP ${expected}, got ${res.status}` +
        (json?.message ? `\n      message: ${json.message}` : "")
    );
  }
  console.log(
    `  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name} \x1b[2m→ ${res.status}\x1b[0m`
  );
  return { res, json, db };
}

function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++;
  else {
    failed++;
    failures.push(`${name}\n      expected: ${expected}\n      actual: ${actual}`);
  }
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}`);
}

const ORDERS = "/v1/databases/default/collections/orders/documents";
const INV = "/v1/databases/default/collections/inventory/documents";
const SETTINGS = "/v1/databases/default/collections/settings/documents";
const MENU = "/v1/databases/default/collections/menu/documents";

console.log("\n\x1b[1mAUTHENTICATION\x1b[0m");
await expectStatus("no key                     => 401", { method: "GET", path: ORDERS }, 401);
await expectStatus("bad key                    => 401", { key: "nope", method: "GET", path: ORDERS }, 401);
await expectStatus("cashier key GET            => 200", { key: CSH, method: "GET", path: ORDERS }, 200);
await expectStatus("manager key GET            => 200", { key: MGR, method: "GET", path: ORDERS }, 200);

console.log("\n\x1b[1mTHE AUDIT ACCEPTANCE TEST — cashier DELETE order\x1b[0m");
{
  const { res, json, db } = await expectStatus(
    "cashier DELETE /orders/x    => 403",
    { key: CSH, method: "DELETE", path: `${ORDERS}/order_paid` },
    403
  );
  check("   ...and NO row was deleted", db._deletes.length, 0);
  check("   ...error body is Forbidden", json?.error, "Forbidden");
  check("   ...Arabic reason present", typeof json?.message === "string" && json.message.length > 0, true);
  check("   ...X-Auth-Role header set", res.headers.get("X-Auth-Role"), "cashier");
}
{
  const { db } = await expectStatus(
    "manager DELETE /orders/x    => 200",
    { key: MGR, method: "DELETE", path: `${ORDERS}/order_paid` },
    200
  );
  check("   ...and the row WAS deleted", db._deletes.length, 1);
}

console.log("\n\x1b[1m/api/sync — the previously unguarded bypass\x1b[0m");
{
  const { db } = await expectStatus(
    "cashier sync delete order   => 403",
    { key: CSH, method: "POST", path: "/api/sync", body: { type: "order", action: "delete", data: { id: "order_paid" } } },
    403
  );
  check("   ...and NO row was deleted", db._deletes.length, 0);
}
{
  const { db } = await expectStatus(
    "manager sync delete order   => 200",
    { key: MGR, method: "POST", path: "/api/sync", body: { type: "order", action: "delete", data: { id: "order_paid" } } },
    200
  );
  check("   ...and the row WAS deleted", db._deletes.length, 1);
}
await expectStatus(
  "cashier sync menu write     => 403",
  { key: CSH, method: "POST", path: "/api/sync", body: { type: "menu", action: "update", data: { id: "m1", price: 1 } } },
  403
);
await expectStatus(
  "cashier sync order update   => 200",
  { key: CSH, method: "POST", path: "/api/sync", body: { type: "order", action: "update", data: { id: "order_open", totalAmount: 75 } } },
  200
);

console.log("\n\x1b[1mPRIVILEGE ESCALATION via settings\x1b[0m");
await expectStatus(
  "cashier writes mgr creds    => 403",
  { key: CSH, method: "PATCH", path: `${SETTINGS}/global::brewmaster_manager_creds_v1`, body: { data: { key: "brewmaster_manager_creds_v1", value: "attacker-hash" } } },
  403
);
await expectStatus(
  "cashier writes admin PIN    => 403",
  { key: CSH, method: "POST", path: SETTINGS, body: { documentId: "global::brewmaster_admin_pin", data: { key: "brewmaster_admin_pin", value: "pinhash$aa$bb" } } },
  403
);
await expectStatus(
  "cashier writes tax rate     => 403",
  { key: CSH, method: "PATCH", path: `${SETTINGS}/global::brewmaster_tax_rate`, body: { data: { key: "brewmaster_tax_rate", value: "0" } } },
  403
);
await expectStatus(
  "manager writes mgr creds    => 200",
  { key: MGR, method: "PATCH", path: `${SETTINGS}/global::brewmaster_manager_creds_v1`, body: { data: { key: "brewmaster_manager_creds_v1", value: "new-hash" } } },
  200
);
await expectStatus(
  "cashier writes language     => 200",
  { key: CSH, method: "PATCH", path: `${SETTINGS}/global::brewmaster_language`, body: { data: { key: "brewmaster_language", value: "ar" } } },
  200
);

console.log("\n\x1b[1mREFUND escalation (server-verified PIN)\x1b[0m");
await expectStatus(
  "cashier refund, no PIN      => 403",
  { key: CSH, method: "PATCH", path: `${ORDERS}/order_paid`, body: { data: { refundedAt: "2026-07-26T10:00:00Z", refundReason: "خطأ" } } },
  403
);
await expectStatus(
  "cashier refund, WRONG PIN   => 403",
  { key: CSH, method: "PATCH", path: `${ORDERS}/order_paid`, pin: "0000", body: { data: { refundedAt: "2026-07-26T10:00:00Z", refundReason: "خطأ" } } },
  403
);
await expectStatus(
  "cashier refund, VALID PIN   => 200",
  { key: CSH, method: "PATCH", path: `${ORDERS}/order_paid`, pin: PIN, body: { data: { refundedAt: "2026-07-26T10:00:00Z", refundReason: "خطأ" } } },
  200
);
await expectStatus(
  "manager refund, no PIN      => 200",
  { key: MGR, method: "PATCH", path: `${ORDERS}/order_paid`, body: { data: { refundedAt: "2026-07-26T10:00:00Z" } } },
  200
);
await expectStatus(
  "valid PIN does NOT unlock soft-delete => 403",
  { key: CSH, method: "PATCH", path: `${ORDERS}/order_paid`, pin: PIN, body: { data: { deletedAt: "2026-07-26T10:00:00Z" } } },
  403
);

console.log("\n\x1b[1mORDER money fields\x1b[0m");
await expectStatus(
  "cashier collects payment    => 200",
  { key: CSH, method: "PATCH", path: `${ORDERS}/order_open`, body: { data: { paymentStatus: "Paid", taxRate: 0.1, taxAmount: 5, grandTotal: 55, paidAt: "2026-07-26T10:00:00Z" } } },
  200
);
await expectStatus(
  "cashier re-prices PAID      => 403",
  { key: CSH, method: "PATCH", path: `${ORDERS}/order_paid`, body: { data: { grandTotal: 5 } } },
  403
);
await expectStatus(
  "manager re-prices PAID      => 200",
  { key: MGR, method: "PATCH", path: `${ORDERS}/order_paid`, body: { data: { grandTotal: 5 } } },
  200
);

console.log("\n\x1b[1mREGRESSION — whole-object sync must not 403\x1b[0m");
await expectStatus(
  "resend identical paid order => 200",
  {
    key: CSH,
    method: "PATCH",
    path: `${ORDERS}/order_paid`,
    body: {
      data: {
        id: "order_paid",
        orderNumber: "5",
        totalAmount: 100,
        grandTotal: 110,
        taxRate: 0.1,
        taxAmount: 10,
        paymentStatus: "Paid",
        refundedAt: null,
        refundReason: null,
        deletedAt: null,
        items: [],
      },
    },
  },
  200
);
await expectStatus(
  "stock deduct w/ full object => 200",
  { key: CSH, method: "PATCH", path: `${INV}/inv_milk`, body: { data: { id: "inv_milk", name: "Milk", unit: "L", stock: 8, minStock: 5, costPerUnit: 25 } } },
  200
);
// The REAL production path: inventoryService.update() pushes via cloudUpsert(),
// which is POST-as-upsert — not PATCH. Must not be mistaken for a create.
await expectStatus(
  "stock deduct via POST upsert => 201",
  { key: CSH, method: "POST", path: INV, body: { documentId: "inv_milk", data: { id: "inv_milk", name: "Milk", unit: "L", stock: 7, minStock: 5, costPerUnit: 25 } } },
  201
);
await expectStatus(
  "stock RESTORE via POST upsert => 201",
  { key: CSH, method: "POST", path: INV, body: { documentId: "inv_milk", data: { id: "inv_milk", name: "Milk", unit: "L", stock: 14, minStock: 5, costPerUnit: 25 } } },
  201
);
await expectStatus(
  "cost change via POST upsert  => 403",
  { key: CSH, method: "POST", path: INV, body: { documentId: "inv_milk", data: { id: "inv_milk", name: "Milk", stock: 10, costPerUnit: 999 } } },
  403
);
// Orders take the same POST-upsert path on every create AND update.
await expectStatus(
  "order update via POST upsert => 201",
  { key: CSH, method: "POST", path: ORDERS, body: { documentId: "order_open", data: { id: "order_open", totalAmount: 80, paymentStatus: "Unpaid", items: [] } } },
  201
);

console.log("\n\x1b[1mINVENTORY + MENU\x1b[0m");
await expectStatus(
  "cashier changes cost        => 403",
  { key: CSH, method: "PATCH", path: `${INV}/inv_milk`, body: { data: { stock: 10, costPerUnit: 1 } } },
  403
);
await expectStatus(
  "cashier creates inv item    => 403",
  { key: CSH, method: "POST", path: INV, body: { documentId: "inv_new", data: { name: "New", stock: 1 } } },
  403
);
await expectStatus(
  "cashier writes menu         => 403",
  { key: CSH, method: "POST", path: MENU, body: { documentId: "m1", data: { name: "Hacked", price: 1 } } },
  403
);
await expectStatus(
  "manager writes menu         => 200",
  { key: MGR, method: "POST", path: MENU, body: { documentId: "m1", data: { name: "Latte", price: 55 } } },
  201
);

console.log("\n\x1b[1mPUBLIC menu stays unauthenticated\x1b[0m");
await expectStatus("guest GET /public/menu      => 200", { method: "GET", path: "/public/menu" }, 200);

console.log("\n\x1b[1mFAIL-CLOSED when no secrets configured\x1b[0m");
{
  const res = await worker.fetch(
    new Request("https://w.dev" + ORDERS, { method: "GET", headers: { Authorization: "Bearer anything" } }),
    { DB: makeDB(SEED), ALLOWED_ORIGINS: "https://pos.engaz.tech" }
  );
  check("no secrets set => 503, never open", res.status, 503);
}
{
  // Legacy shared key still works as manager during rollout.
  const res = await worker.fetch(
    new Request("https://w.dev" + `${ORDERS}/order_paid`, { method: "DELETE", headers: { Authorization: "Bearer legacy_key_zzz" } }),
    { DB: makeDB(SEED), API_KEY: "legacy_key_zzz", ALLOWED_ORIGINS: "https://pos.engaz.tech" }
  );
  check("legacy API_KEY acts as manager", res.status, 200);
}

console.log("\n" + "─".repeat(64));
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mALL ${passed} E2E CHECKS PASSED\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m${failed} FAILED\x1b[0m / ${passed + failed} total\n`);
  failures.forEach((f) => console.log(`  \x1b[31m✗\x1b[0m ${f}`));
}
console.log("─".repeat(64));
process.exit(failed === 0 ? 0 : 1);
