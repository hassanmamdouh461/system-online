/**
 * Permission matrix verification.
 *
 * Runs with zero dependencies:  node --experimental-strip-types test-permissions.mjs
 * (Node 22.6+ / 24+ strips the TypeScript annotations at load time.)
 *
 * Every row of the agreed matrix is asserted, plus the regression cases that
 * make the matrix real rather than cosmetic:
 *   - whole-object sync must NOT be rejected just for carrying a frozen field
 *   - the settings-table privilege-escalation path must be closed
 *   - the audit's acceptance test: cashier DELETE on an order => 403
 */

import {
  resolveRole,
  can,
  timingSafeEqual,
  valuesEqual,
  changedFields,
  settingKeyFrom,
  isOrderSettled
} from "./src/permissions.ts";

const ENV = {
  MANAGER_API_KEY: "mgr_secret_key_aaaaaaaaaaaa",
  CASHIER_API_KEY: "csh_secret_key_bbbbbbbbbbbb",
  API_KEY: "legacy_shared_key_cccccccccc"
};

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}\n      expected: ${expected}\n      actual:   ${actual}`);
  }
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}`);
}

function allowed(ctx) {
  return can(ctx).allowed;
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ─────────────────────────────────────────────────────────────────────────────
section("1. Role resolution — role comes from the KEY, never the client");

check("manager key  => manager", resolveRole(ENV.MANAGER_API_KEY, ENV)?.role, "manager");
check("cashier key  => cashier", resolveRole(ENV.CASHIER_API_KEY, ENV)?.role, "cashier");
check("legacy key   => manager (transitional)", resolveRole(ENV.API_KEY, ENV)?.role, "manager");
check("legacy key   => flagged as legacy", resolveRole(ENV.API_KEY, ENV)?.viaLegacyKey, true);
check("real key     => not flagged legacy", resolveRole(ENV.CASHIER_API_KEY, ENV)?.viaLegacyKey, false);
check("wrong key    => null (401)", resolveRole("wrong-key", ENV), null);
check("empty token  => null (401)", resolveRole("", ENV), null);
check("null token   => null (401)", resolveRole(null, ENV), null);
check("key prefix   => null (no partial match)", resolveRole("csh_secret_key_b", ENV), null);
check("unset secrets => null, never allow-all", resolveRole("anything", {}), null);

section("2. Constant-time comparison");
check("equal strings match", timingSafeEqual("abc123", "abc123"), true);
check("different strings differ", timingSafeEqual("abc123", "abc124"), false);
check("length mismatch differs", timingSafeEqual("abc", "abcdef"), false);
check("empty vs empty", timingSafeEqual("", ""), true);

// ─────────────────────────────────────────────────────────────────────────────
section("3. THE AUDIT ACCEPTANCE TEST — cashier DELETE must be 403");

check(
  "cashier DELETE order            => DENIED",
  allowed({ role: "cashier", table: "orders", method: "DELETE", docId: "order_1" }),
  false
);
check(
  "cashier DELETE menu_item        => DENIED",
  allowed({ role: "cashier", table: "menu_items", method: "DELETE", docId: "m1" }),
  false
);
check(
  "cashier DELETE customer         => DENIED",
  allowed({ role: "cashier", table: "customers", method: "DELETE", docId: "c1" }),
  false
);
check(
  "cashier DELETE inventory        => DENIED",
  allowed({ role: "cashier", table: "inventory", method: "DELETE", docId: "i1" }),
  false
);
check(
  "manager DELETE order            => ALLOWED",
  allowed({ role: "manager", table: "orders", method: "DELETE", docId: "order_1" }),
  true
);
check(
  "cashier DELETE returns Arabic reason",
  typeof can({ role: "cashier", table: "orders", method: "DELETE", docId: "x" }).reason === "string",
  true
);
check(
  "cashier DELETE carries machine code",
  can({ role: "cashier", table: "orders", method: "DELETE", docId: "x" }).code,
  "cashier_delete_forbidden"
);

// ─────────────────────────────────────────────────────────────────────────────
section("4. Orders — create / edit / collect payment ALLOWED for cashier");

check(
  "cashier creates order",
  allowed({
    role: "cashier", table: "orders", method: "POST", docId: "o1",
    submitted: { id: "o1", orderNumber: "5", totalAmount: 100, paymentStatus: "Unpaid" },
    current: null
  }),
  true
);
check(
  "cashier edits UNPAID order items",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { totalAmount: 150, items: '[{"x":1}]' },
    current: { id: "o1", totalAmount: 100, paymentStatus: "Unpaid" }
  }),
  true
);
check(
  "cashier COLLECTS PAYMENT (writes tax + grandTotal)  => ALLOWED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { paymentStatus: "Paid", taxRate: 0.1, taxAmount: 10, grandTotal: 110, paidAt: "2026-07-26T12:00:00Z" },
    current: { id: "o1", totalAmount: 100, paymentStatus: "Unpaid", taxRate: null, taxAmount: null }
  }),
  true
);

section("5. Orders — settled orders freeze, so a paid order can't be re-priced");

check(
  "cashier re-prices PAID order    => DENIED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { grandTotal: 5 },
    current: { id: "o1", grandTotal: 110, paymentStatus: "Paid" }
  }),
  false
);
check(
  "cashier edits PAID order items  => DENIED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { items: '[{"hacked":1}]' },
    current: { id: "o1", items: '[{"real":1}]', paymentStatus: "Paid" }
  }),
  false
);
check(
  "manager re-prices PAID order    => ALLOWED",
  allowed({
    role: "manager", table: "orders", method: "PATCH", docId: "o1",
    submitted: { grandTotal: 5 },
    current: { id: "o1", grandTotal: 110, paymentStatus: "Paid" }
  }),
  true
);
check(
  "cashier updates NON-money field on paid order (customerName) => ALLOWED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { customerName: "Ahmed" },
    current: { id: "o1", customerName: null, paymentStatus: "Paid", grandTotal: 110 }
  }),
  true
);

section("6. Refund — cashier needs escalation, manager does not");

check(
  "cashier refund WITHOUT pin      => DENIED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { refundedAt: "2026-07-26T12:00:00Z", refundReason: "خطأ" },
    current: { id: "o1", refundedAt: null, paymentStatus: "Paid" },
    refundEscalated: false
  }),
  false
);
check(
  "cashier refund WITH valid pin   => ALLOWED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { refundedAt: "2026-07-26T12:00:00Z", refundReason: "خطأ" },
    current: { id: "o1", refundedAt: null, paymentStatus: "Paid" },
    refundEscalated: true
  }),
  true
);
check(
  "manager refund, no pin needed   => ALLOWED",
  allowed({
    role: "manager", table: "orders", method: "PATCH", docId: "o1",
    submitted: { refundedAt: "2026-07-26T12:00:00Z" },
    current: { id: "o1", refundedAt: null, paymentStatus: "Paid" }
  }),
  true
);
check(
  "escalated pin does NOT unlock soft-delete => DENIED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { deletedAt: "2026-07-26T12:00:00Z" },
    current: { id: "o1", deletedAt: null },
    refundEscalated: true
  }),
  false
);
check(
  "cashier soft-delete (deletedAt) => DENIED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { deletedAt: "2026-07-26T12:00:00Z" },
    current: { id: "o1", deletedAt: null }
  }),
  false
);

// ─────────────────────────────────────────────────────────────────────────────
section("7. REGRESSION — whole-object sync must not 403 on unchanged frozen fields");
console.log("  \x1b[2m(syncService sends the entire row; presence != change)\x1b[0m");

check(
  "resend of unchanged refundedAt=null  => ALLOWED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { id: "o1", totalAmount: 100, refundedAt: null, refundReason: null, deletedAt: null },
    current: { id: "o1", totalAmount: 100, refundedAt: null, refundReason: null, deletedAt: null }
  }),
  true
);
check(
  "undefined vs null on frozen field    => ALLOWED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { refundedAt: undefined, totalAmount: 120 },
    current: { id: "o1", refundedAt: null, totalAmount: 100, paymentStatus: "Unpaid" }
  }),
  true
);
check(
  "already-refunded order resends same refundedAt => ALLOWED",
  allowed({
    role: "cashier", table: "orders", method: "PATCH", docId: "o1",
    submitted: { refundedAt: "2026-07-01T10:00:00Z", customerName: "Sara" },
    current: { id: "o1", refundedAt: "2026-07-01T10:00:00Z", paymentStatus: "Refunded", customerName: null }
  }),
  true
);
check(
  "numeric string '100' vs number 100 not a change",
  valuesEqual("100", 100),
  true
);
check("null vs undefined equal", valuesEqual(null, undefined), true);
check("empty string vs null equal", valuesEqual("", null), true);
check("bool true vs 1 equal", valuesEqual(true, 1), true);
check("0 vs null NOT equal", valuesEqual(0, null), false);
check("100 vs 200 NOT equal", valuesEqual(100, 200), false);
check("changedFields ignores id", changedFields({ id: "x", a: 1 }, { id: "y", a: 1 }).length, 0);
check("changedFields on new row lists all", changedFields({ a: 1, b: 2 }, null).length, 2);

// ─────────────────────────────────────────────────────────────────────────────
section("8. SETTINGS — the privilege-escalation hole is closed");
console.log("  \x1b[2m(password hashes live in the settings table as global::<key>)\x1b[0m");

for (const key of [
  "brewmaster_manager_creds_v1",
  "brewmaster_admin_creds_v2",
  "brewmaster_admin_pin"
]) {
  check(
    `cashier writes ${key.padEnd(28)} => DENIED`,
    allowed({
      role: "cashier", table: "settings", method: "PATCH",
      docId: `global::${key}`,
      submitted: { key, value: "attacker-controlled-hash" },
      current: { id: `global::${key}`, key, value: "real-hash" }
    }),
    false
  );
}
check(
  "cashier writes tax rate         => DENIED",
  allowed({
    role: "cashier", table: "settings", method: "PATCH", docId: "global::brewmaster_tax_rate",
    submitted: { key: "brewmaster_tax_rate", value: "0" },
    current: { id: "global::brewmaster_tax_rate", key: "brewmaster_tax_rate", value: "0.1" }
  }),
  false
);
check(
  "cashier writes store config     => DENIED",
  allowed({
    role: "cashier", table: "settings", method: "PATCH", docId: "global::brewmaster_store_config",
    submitted: { key: "brewmaster_store_config", value: "{}" }
  }),
  false
);
check(
  "escalation via POST upsert too  => DENIED",
  allowed({
    role: "cashier", table: "settings", method: "POST", docId: "global::brewmaster_admin_pin",
    submitted: { key: "brewmaster_admin_pin", value: "pinhash$aa$bb" }
  }),
  false
);
check(
  "key inferred from docId when body omits it => DENIED",
  allowed({
    role: "cashier", table: "settings", method: "PATCH",
    docId: "global::brewmaster_manager_creds_v1",
    submitted: { value: "sneaky" }
  }),
  false
);
check(
  "unknown setting key fails CLOSED => DENIED",
  allowed({
    role: "cashier", table: "settings", method: "PATCH", docId: "global::some_new_key",
    submitted: { key: "some_new_key", value: "x" }
  }),
  false
);
check(
  "manager writes manager creds    => ALLOWED",
  allowed({
    role: "manager", table: "settings", method: "PATCH", docId: "global::brewmaster_manager_creds_v1",
    submitted: { key: "brewmaster_manager_creds_v1", value: "new-hash" }
  }),
  true
);

section("9. SETTINGS — cashier's own shift settings still work");

for (const key of ["brewmaster_language", "pos_tables_list", "custom_menu_categories", "removed_menu_categories"]) {
  check(
    `cashier writes ${key.padEnd(28)} => ALLOWED`,
    allowed({
      role: "cashier", table: "settings", method: "PATCH", docId: `global::${key}`,
      submitted: { key, value: "[]" }
    }),
    true
  );
}
check("settingKeyFrom reads body.key", settingKeyFrom({ key: "abc" }, null), "abc");
check("settingKeyFrom parses global:: id", settingKeyFrom({}, "global::my_key"), "my_key");
check("settingKeyFrom parses branch:: id", settingKeyFrom({}, "main_branch::my_key"), "my_key");
check("settingKeyFrom bare id", settingKeyFrom({}, "bare_key"), "bare_key");

// ─────────────────────────────────────────────────────────────────────────────
section("10. MENU + RECIPES — manager-only writes");

check(
  "cashier writes menu_item        => DENIED",
  allowed({ role: "cashier", table: "menu_items", method: "POST", docId: "m1", submitted: { name: "Latte", price: 1 } }),
  false
);
check(
  "cashier changes menu price      => DENIED",
  allowed({
    role: "cashier", table: "menu_items", method: "PATCH", docId: "m1",
    submitted: { price: 1 }, current: { id: "m1", price: 50 }
  }),
  false
);
check(
  "cashier writes recipe           => DENIED",
  allowed({ role: "cashier", table: "recipes", method: "POST", docId: "r1", submitted: { quantity: 2 } }),
  false
);
check(
  "manager writes menu_item        => ALLOWED",
  allowed({ role: "manager", table: "menu_items", method: "POST", docId: "m1", submitted: { name: "Latte" } }),
  true
);

section("11. INVENTORY — cashier deducts on sale, cannot re-price or create");

check(
  "cashier DEDUCTS stock on sale   => ALLOWED",
  allowed({
    role: "cashier", table: "inventory", method: "PATCH", docId: "i1",
    submitted: { stock: 8, costPerUnit: 25, minStock: 5, name: "Milk", unit: "L" },
    current: { id: "i1", stock: 10, costPerUnit: 25, minStock: 5, name: "Milk", unit: "L" }
  }),
  true
);
check(
  "cashier RESTORES stock (cancel) => ALLOWED",
  allowed({
    role: "cashier", table: "inventory", method: "PATCH", docId: "i1",
    submitted: { stock: 12, costPerUnit: 25 },
    current: { id: "i1", stock: 10, costPerUnit: 25 }
  }),
  true
);
check(
  "cashier changes costPerUnit     => DENIED",
  allowed({
    role: "cashier", table: "inventory", method: "PATCH", docId: "i1",
    submitted: { stock: 10, costPerUnit: 1 },
    current: { id: "i1", stock: 10, costPerUnit: 25 }
  }),
  false
);
check(
  "cashier renames item            => DENIED",
  allowed({
    role: "cashier", table: "inventory", method: "PATCH", docId: "i1",
    submitted: { name: "Fake" }, current: { id: "i1", name: "Milk" }
  }),
  false
);
check(
  "cashier changes minStock        => DENIED",
  allowed({
    role: "cashier", table: "inventory", method: "PATCH", docId: "i1",
    submitted: { minStock: 0 }, current: { id: "i1", minStock: 5 }
  }),
  false
);
check(
  "cashier CREATES inventory item  => DENIED",
  allowed({
    role: "cashier", table: "inventory", method: "POST", docId: "i9",
    submitted: { name: "New", stock: 5 }, current: null
  }),
  false
);
check(
  "manager creates inventory item  => ALLOWED",
  allowed({
    role: "manager", table: "inventory", method: "POST", docId: "i9",
    submitted: { name: "New", stock: 5 }, current: null
  }),
  true
);
check(
  "cashier writes inventory_transaction => ALLOWED",
  allowed({
    role: "cashier", table: "inventory_transactions", method: "POST", docId: "t1",
    submitted: { item_id: "i1", type: "OUT", quantity: 2 }, current: null
  }),
  true
);

section("12. Snapshots + customers");

check(
  "cashier writes snapshot         => DENIED",
  allowed({ role: "cashier", table: "snapshots", method: "POST", docId: "s1", submitted: { payload: "{}" } }),
  false
);
check(
  "manager writes snapshot         => ALLOWED",
  allowed({ role: "manager", table: "snapshots", method: "POST", docId: "s1", submitted: { payload: "{}" } }),
  true
);
check(
  "cashier creates customer        => ALLOWED",
  allowed({ role: "cashier", table: "customers", method: "POST", docId: "c1", submitted: { name: "Ali" }, current: null }),
  true
);
check(
  "cashier creates company         => ALLOWED",
  allowed({ role: "cashier", table: "companies", method: "POST", docId: "co1", submitted: { name: "ACME" }, current: null }),
  true
);

section("13. Reads stay open (POS + login must keep working)");

for (const t of ["orders", "menu_items", "inventory", "settings", "customers", "recipes", "snapshots"]) {
  check(`cashier GET ${t.padEnd(22)} => ALLOWED`, allowed({ role: "cashier", table: t, method: "GET" }), true);
}

section("14. Helpers");
check("isOrderSettled(Paid)", isOrderSettled({ paymentStatus: "Paid" }), true);
check("isOrderSettled(Refunded)", isOrderSettled({ paymentStatus: "Refunded" }), true);
check("isOrderSettled(Unpaid)", isOrderSettled({ paymentStatus: "Unpaid" }), false);
check("isOrderSettled(null)", isOrderSettled(null), false);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(64));
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mALL ${passed} CHECKS PASSED\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m${failed} FAILED\x1b[0m / ${passed + failed} total\n`);
  failures.forEach((f) => console.log(`  \x1b[31m✗\x1b[0m ${f}`));
}
console.log("─".repeat(64));
process.exit(failed === 0 ? 0 : 1);
