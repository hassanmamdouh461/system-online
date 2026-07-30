/**
 * Refund is TERMINAL — server-side one-way latch (issue: refunded orders
 * resurrect as Unpaid after the manager clears browser cache).
 *
 * Scenario that motivated this guard:
 *   1. Manager refunds a paid invoice → D1 row becomes paymentStatus='Refunded'
 *      with refundedAt/refundReason set.
 *   2. A stale device copy (or a tab that hydrated before the refund landed)
 *      uploads the OLD row (paymentStatus='Unpaid'/'Paid', no refund markers).
 *   3. The freshness guard cannot stop it: an incoming updatedAt that is NULL
 *      or missing makes `excluded.updatedAt > orders.updatedAt` evaluate to
 *      NULL (not false), so the stale write lands and the refunded order
 *      flips back to "not paid" in D1 — for every device, including the
 *      manager's freshly-wiped browser on its next hydrate. The REST PATCH
 *      path has no freshness guard at all.
 *
 * The fix applies applyRefundLatch() at all three write boundaries
 * (/api/sync upsert, REST POST upsert, REST PATCH): when the stored row is
 * refunded, an incoming write that carries no refund marker is rewritten to
 * keep the Refunded state before it reaches SQL.
 *
 * The SQL is built inline inside src/index.ts, so this test asserts the
 * latch helper's behaviour (via import) AND its wiring at the three sites.
 *
 *   node --experimental-strip-types test/refund-latch.test.mts
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

console.log("\n1) applyRefundLatch behavioural contract");

// Import the real helper — index.ts exports it for testability.
const { applyRefundLatch } = await import("../src/index.ts");
assert.equal(typeof applyRefundLatch, "function", "applyRefundLatch is exported");

// A refunded stored row + stale Unpaid write → state is preserved.
{
  const current = { paymentStatus: "Refunded", refundedAt: "2026-07-30T10:00:00Z", refundReason: "Customer return", status: "Cancelled" };
  const stale = { id: "o1", paymentStatus: "Unpaid", totalAmount: 100, status: "Completed", customerName: "Ali" };
  const out = applyRefundLatch({ ...stale }, current);
  assert.equal(out.paymentStatus, "Refunded", "paymentStatus latched to Refunded");
  assert.equal(out.refundedAt, current.refundedAt, "original refund timestamp kept");
  assert.equal(out.refundReason, current.refundReason, "original refund reason kept");
  assert.equal(out.status, "Cancelled", "voided status kept");
  assert.equal(out.customerName, "Ali", "legit new fields still land");
  ok(true, "stale Unpaid write cannot resurrect a refunded order");
}

// Refunded marker via refundedAt alone (paymentStatus may read 'Paid' on a legacy row).
{
  const current = { paymentStatus: "Paid", refundedAt: "2026-07-30T10:00:00Z", refundReason: "void", status: "Cancelled" };
  const out = applyRefundLatch({ id: "o2", paymentStatus: "Paid" }, current);
  assert.equal(out.paymentStatus, "Refunded", "refundedAt marker alone triggers the latch");
  ok(true, "refundedAt-only stored row is protected");
}

// snake_case stored columns (raw D1 row shape) also trigger the latch.
{
  const current = { paymentStatus: "Refunded", refunded_at: "2026-07-30T10:00:00Z", refund_reason: "void", status: "Cancelled" };
  const out = applyRefundLatch({ id: "o3", paymentStatus: "Unpaid" }, current);
  assert.equal(out.paymentStatus, "Refunded", "snake_case refunded_at triggers the latch");
  assert.equal(out.refundedAt, current.refunded_at, "snake_case timestamp carried over");
  ok(true, "raw D1 row shapes are handled");
}

// The refund write itself is NEVER clobbered by the latch.
{
  const current = { paymentStatus: "Paid", status: "Completed" };
  const refundWrite = { id: "o4", paymentStatus: "Refunded", refundedAt: "2026-07-30T12:00:00Z", refundReason: "return", status: "Cancelled" };
  const out = applyRefundLatch({ ...refundWrite }, current);
  assert.equal(out.paymentStatus, "Refunded", "refund write passes through");
  assert.equal(out.refundedAt, refundWrite.refundedAt, "refund write keeps its own timestamp");
  ok(true, "a genuine refund write is untouched");
}

// No stored refund → no latch (normal writes unaffected).
{
  const current = { paymentStatus: "Paid", status: "Completed" };
  const normal = { id: "o5", paymentStatus: "Unpaid", status: "New" };
  const out = applyRefundLatch({ ...normal }, current);
  assert.equal(out.paymentStatus, "Unpaid", "non-refunded rows are not latched");
  ok(true, "ordinary orders are unaffected");
}

// No stored row (brand-new insert) → no latch.
{
  const out = applyRefundLatch({ id: "o6", paymentStatus: "Unpaid" }, null);
  assert.equal(out.paymentStatus, "Unpaid", "inserts are untouched");
  ok(true, "new-row inserts pass through");
}

console.log("\n2) latch is wired at ALL THREE order write boundaries");

const latchSites = src.match(/applyRefundLatch\(normalized, currentRow\)|applyRefundLatch\(data, currentRow\)/g) || [];
assert.equal(latchSites.length, 3, "expected exactly 3 latch call sites (/api/sync, REST POST, REST PATCH)");
ok(true, "sync upsert + REST upsert + PATCH all apply the latch");

// The PATCH path specifically had NO freshness guard — make sure its latch
// runs BEFORE the UPDATE statement is built.
const patchIdx = src.indexOf('if (method === "PATCH")');
const patchLatchIdx = src.indexOf("applyRefundLatch(data, currentRow)", patchIdx);
const patchUpdateIdx = src.indexOf("const sets = keys.map", patchIdx);
ok(patchLatchIdx > patchIdx && patchLatchIdx < patchUpdateIdx, "PATCH latch runs before the UPDATE is built");

console.log(`\n${passed} checks passed`);
