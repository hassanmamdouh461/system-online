/**
 * Deletion is TERMINAL — server-side one-way latch + tombstone freshness
 * override (issue: refund an order, delete it, clear the cache → it comes back).
 *
 * Scenario that motivated this guard:
 *   1. Manager refunds order #4 → D1 row updated (paymentStatus='Refunded').
 *   2. Manager deletes it one click later → the client pushes a soft-delete
 *      tombstone (the whole row plus `deletedAt`, queued as action 'update').
 *   3. The upsert freshness guard `excluded.updatedAt > orders.updatedAt`
 *      discards the tombstone whenever its updatedAt is not STRICTLY newer than
 *      the refund write from milliseconds earlier (same-ms writes, clock skew
 *      across devices). D1 answers 200 { stale: true } and keeps the live row.
 *   4. syncService saw HTTP 200 and retired the queue record as synced, so the
 *      delete was never retried. IndexedDB still showed it deleted — until the
 *      cache was cleared, when hydrate restored D1's still-undeleted row.
 *
 * Two server-side fixes are asserted here:
 *   - applyDeleteLatch(): a stored `deletedAt` can never be cleared by a later
 *     write, at all three order write boundaries (/api/sync, REST POST, PATCH).
 *   - the ON CONFLICT freshness clause carries an OR-branch letting a tombstone
 *     land even when its updatedAt ties the stored row's.
 *
 *   node --experimental-strip-types test/delete-latch.test.mts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../src/index.ts"), "utf8");

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

console.log("\n1) applyDeleteLatch behavioural contract");

const { applyDeleteLatch } = await import("../src/index.ts");
assert.equal(typeof applyDeleteLatch, "function", "applyDeleteLatch is exported");

// A deleted stored row + a later live write → the row STAYS deleted.
{
  const current = { paymentStatus: "Refunded", deletedAt: "2026-08-03T10:00:00Z" };
  const stale = { id: "o1", paymentStatus: "Refunded", totalAmount: 171, customerName: "Ali" };
  const out = applyDeleteLatch({ ...stale }, current, "orders");
  assert.equal(out.deletedAt, current.deletedAt, "deletedAt latched back on");
  assert.equal(out.customerName, "Ali", "legit new fields still land");
  ok(true, "a later write cannot resurrect a deleted order");
}

// The ORIGINAL deletion timestamp is preserved, not rewritten.
{
  const current = { deletedAt: "2026-08-03T10:00:00Z" };
  const out = applyDeleteLatch({ id: "o2", deletedAt: "" }, current, "orders");
  assert.equal(out.deletedAt, "2026-08-03T10:00:00Z", "empty-string clear is rejected");
  ok(true, "blanking deletedAt is treated as a resurrection attempt");
}

// snake_case stored column (raw D1 row for menu_items/customers/etc).
{
  const current = { deleted_at: "2026-08-03T10:00:00Z" };
  const out = applyDeleteLatch({ id: "m1", name: "Espresso" }, current, "menu_items");
  assert.equal(out.deleted_at, "2026-08-03T10:00:00Z", "snake_case column latched");
  ok(true, "raw D1 row shapes are handled");
}

// The tombstone write itself is NEVER clobbered by the latch.
{
  const current = { deletedAt: "2026-08-03T10:00:00Z" };
  const tombstone = { id: "o3", deletedAt: "2026-08-03T11:00:00Z" };
  const out = applyDeleteLatch({ ...tombstone }, current, "orders");
  assert.equal(out.deletedAt, tombstone.deletedAt, "tombstone re-send keeps its own stamp");
  ok(true, "a genuine delete write is untouched");
}

// No stored deletion / no stored row → no latch.
{
  assert.equal(applyDeleteLatch({ id: "o4", total: 1 }, { paymentStatus: "Paid" }, "orders").deletedAt, undefined);
  assert.equal(applyDeleteLatch({ id: "o5" }, null, "orders").deletedAt, undefined);
  ok(true, "live rows and brand-new inserts pass through untouched");
}

console.log("\n2) latch is wired at ALL THREE order write boundaries");

const sites = src.match(/applyDeleteLatch\((?:normalized|data), currentRow, "orders"\)/g) || [];
assert.equal(sites.length, 3, "expected 3 delete-latch call sites (/api/sync, REST POST, REST PATCH)");
ok(true, "sync upsert + REST upsert + PATCH all apply the delete latch");

// PATCH has no freshness guard at all, so its latch is the only protection.
{
  const patchIdx = src.indexOf('if (method === "PATCH")');
  const latchIdx = src.indexOf('applyDeleteLatch(data, currentRow, "orders")', patchIdx);
  const updateIdx = src.indexOf("const sets = keys.map", patchIdx);
  ok(latchIdx > patchIdx && latchIdx < updateIdx, "PATCH latch runs before the UPDATE is built");
}

// The latch needs deletedAt in the current-row lookup, or it can never fire.
{
  const lookups = src.match(/SELECT paymentStatus, refundedAt, refundReason, status, deletedAt FROM orders/g) || [];
  assert.equal(lookups.length, 3, "all three order current-row lookups select deletedAt");
  ok(true, "current-row lookups read deletedAt");
}

console.log("\n3) a tombstone beats the upsert freshness guard");

{
  assert.ok(src.includes("function tombstoneOverride"), "tombstoneOverride helper exists");
  const guards = src.match(/\$\{tombstoneOverride\(table\)\}/g) || [];
  assert.equal(guards.length, 2, "both upsert sites (/api/sync + REST POST) carry the override");
  ok(true, "freshness clause exempts the not-deleted → deleted transition");

  // Only the DELETING transition is exempt: an already-deleted row must not be
  // re-updated by stale writers through this branch.
  const helper = src.slice(src.indexOf("function tombstoneOverride"));
  ok(
    /\$\{table\}\.\$\{col\} IS NULL OR \$\{table\}\.\$\{col\} = ''/.test(helper),
    "override only applies when the stored row is NOT yet deleted"
  );
}

console.log(`\n${passed} checks passed`);
