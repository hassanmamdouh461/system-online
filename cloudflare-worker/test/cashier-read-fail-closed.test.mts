/**
 * canReadSettingKey fails CLOSED for cashiers when the row's key cannot be
 * resolved (permissions.ts).
 *
 * Previously `if (!key) return true` treated an unresolvable key as non-sensitive
 * "by construction". That is a fail-open: any settings row whose key column is
 * missing/unparseable became world-readable to a cashier. Now only managers read
 * keyless rows.
 *
 *   node --experimental-strip-types test/cashier-read-fail-closed.test.mts
 */

import assert from "node:assert/strict";
import { canReadSettingKey } from "../src/permissions.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

console.log("\n1) null / undefined / empty key");
ok(canReadSettingKey("manager", null) === true, "manager + null key → readable");
ok(canReadSettingKey("manager", undefined) === true, "manager + undefined key → readable");
ok(canReadSettingKey("cashier", null) === false, "cashier + null key → DENIED (fail-closed)");
ok(canReadSettingKey("cashier", undefined) === false, "cashier + undefined key → DENIED (fail-closed)");
ok(canReadSettingKey("cashier", "") === false, "cashier + empty key → DENIED (fail-closed)");

console.log("\n2) explicit forbidden key stays denied");
ok(canReadSettingKey("cashier", "brewmaster_manager_creds_v1") === false, "cashier + manager creds key → DENIED");
ok(canReadSettingKey("cashier", "brewmaster_telegram_bot_token") === false, "cashier + telegram token → DENIED");
ok(canReadSettingKey("manager", "brewmaster_manager_creds_v1") === true, "manager + manager creds key → readable");

console.log("\n3) ordinary allowed key stays allowed");
ok(canReadSettingKey("cashier", "brewmaster_language") === true, "cashier + language key → readable");
ok(canReadSettingKey("cashier", "brewmaster_tax_rate") === true, "cashier + tax rate key → readable");
ok(canReadSettingKey("manager", "brewmaster_language") === true, "manager + language key → readable");

console.log(`\n✅ cashier-read-fail-closed.test: ${passed} assertions passed\n`);
