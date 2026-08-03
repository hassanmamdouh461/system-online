/**
 * Server-side atomic stock deltas — the multi-tablet oversell fix.
 *
 * The bug these tests lock down: stock used to be computed on the tablet and
 * pushed as an ABSOLUTE row value. Two tills selling the same ingredient at the
 * same moment both read stock=10, computed 10-3 and 10-4, and pushed 7 and 6.
 * The upsert freshness guard only rejects OLDER writes — it cannot merge two
 * deltas — so the later timestamp won and the shop was left with 6 instead of 3.
 * Stock drifted UP on every concurrent sale, i.e. the shop oversold ingredients
 * it had physically already used.
 *
 * These tests model the D1 semantics the worker relies on:
 *   - `stock = MAX(0, stock + delta)` composes concurrent deltas
 *   - the op-id ledger makes a retried delta a no-op instead of a double deduct
 */
import { strict as assert } from 'node:assert';

/** Minimal stand-in for the inventory row + ledger the worker touches. */
function makeDb(initialStock) {
  return {
    stock: initialStock,
    ops: new Map(), // op_id -> resulting_stock
  };
}

/** Mirrors the worker: ledger insert + relative UPDATE inside one batch. */
function applyDelta(db, opId, delta) {
  if (db.ops.has(opId)) {
    // PRIMARY KEY collision → batch rolls back, stock untouched.
    return { ok: true, duplicate: true, stock: db.ops.get(opId) };
  }
  db.stock = Math.max(0, db.stock + delta);
  db.ops.set(opId, db.stock);
  return { ok: true, stock: db.stock };
}

/** The OLD client behaviour, kept only to prove the bug it caused. */
function legacyAbsoluteWrite(db, readStock, delta) {
  db.stock = Math.max(0, readStock + delta);
  return db.stock;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('REGRESSION: absolute writes from two tills lose a deduction', () => {
  const db = makeDb(10);
  // Both tablets read 10 before either wrote — the real race.
  const readA = db.stock;
  const readB = db.stock;
  legacyAbsoluteWrite(db, readA, -3); // till A pushes 7
  legacyAbsoluteWrite(db, readB, -4); // till B pushes 6, last write wins
  assert.equal(db.stock, 6, 'demonstrates the old behaviour');
  assert.notEqual(db.stock, 3, 'the 3 units till A sold were silently restored');
});

test('atomic deltas from two tills compose correctly', () => {
  const db = makeDb(10);
  applyDelta(db, 'op-a', -3);
  applyDelta(db, 'op-b', -4);
  assert.equal(db.stock, 3, '10 - 3 - 4 = 3');
});

test('five tablets selling concurrently all land', () => {
  const db = makeDb(100);
  for (let i = 0; i < 5; i++) applyDelta(db, `op-${i}`, -7);
  assert.equal(db.stock, 65, '100 - (5 x 7) = 65');
});

test('a retried delta does not deduct twice', () => {
  const db = makeDb(10);
  const first = applyDelta(db, 'op-x', -3);
  const replay = applyDelta(db, 'op-x', -3); // lost response → client retries
  assert.equal(db.stock, 7, 'stock moved exactly once');
  assert.equal(replay.duplicate, true, 'replay recognised as already applied');
  assert.equal(replay.stock, first.stock, 'retry returns the same answer');
});

test('stock clamps at zero and never goes negative', () => {
  const db = makeDb(2);
  applyDelta(db, 'op-1', -5);
  assert.equal(db.stock, 0, 'clamped, matching the client-side clamp');
});

test('restore (positive delta) composes with deductions', () => {
  const db = makeDb(10);
  applyDelta(db, 'op-sale', -4);
  applyDelta(db, 'op-cancel', +4); // order cancelled on another tablet
  assert.equal(db.stock, 10, 'net zero');
});

test('interleaved deduct/restore across tablets stays exact', () => {
  const db = makeDb(50);
  const moves = [-5, +2, -8, -1, +3, -6];
  moves.forEach((d, i) => applyDelta(db, `op-${i}`, d));
  assert.equal(db.stock, 50 + moves.reduce((a, b) => a + b, 0));
  assert.equal(db.stock, 35);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} stock-delta tests passed`);
process.exit(failed === 0 ? 0 : 1);
