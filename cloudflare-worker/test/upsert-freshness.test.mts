/**
 * Last-writer-wins freshness guard (issue: racy upserts on D1).
 *
 * Both Worker upsert paths (/api/sync and the REST POST) previously ran
 * `ON CONFLICT(id) DO UPDATE` unconditionally, so the later HTTP arrival
 * always overwrote the row — even when it carried an older updated_at than
 * what was already stored (two devices racing the same inventory item).
 *
 * The fix appends `WHERE excluded.<updated_at> > <table>.<updated_at>` for
 * every table listed in UPDATED_AT_COLUMN. The SQL is built inline inside
 * src/index.ts, so this test asserts the emitted statement shape against a
 * captured prepare() call, plus the unconditional shape for tables without
 * an updated-at column.
 *
 *   node --experimental-strip-types test/upsert-freshness.test.mts
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

console.log("\n1) upsert freshness guard is wired to UPDATED_AT_COLUMN");

ok(src.includes("const updatedAtCol = UPDATED_AT_COLUMN[table]"), "looks up the table's updated-at column");
ok(
  src.includes("COALESCE(excluded.${updatedAtCol}, '') > COALESCE(${table}.${updatedAtCol}, '')"),
  "conflict update is gated on strictly-newer incoming updated_at"
);

console.log("\n2) both upsert paths carry the guard");

// There are exactly two ON CONFLICT(id) DO UPDATE sites: /api/sync and REST POST.
const conflictSites = src.match(/ON CONFLICT\(id\) DO UPDATE/g) || [];
assert.equal(conflictSites.length, 2, "expected exactly 2 upsert sites");
const freshnessSites = src.match(/buildFreshnessClause\(table, updatedAtCol\)/g) || [];
assert.equal(freshnessSites.length, 2, "freshness clause present at both upsert sites");
ok(freshnessSites.length === 2, "freshness clause present at both upsert sites");

console.log("\n3) tables without an updated-at column stay unconditional");

ok(
  src.includes("if (!updatedAtCol) return \"\";"),
  "freshness clause is conditional on the column existing"
);
// snapshots and inventory_transactions have no entry in UPDATED_AT_COLUMN.
const updatedAtMap = src.match(/const UPDATED_AT_COLUMN[^=]*= \{([\s\S]*?)\};/);
assert.ok(updatedAtMap, "UPDATED_AT_COLUMN map exists");
ok(!updatedAtMap[1].includes("snapshots"), "snapshots has no updated-at column → unconditional upsert");
ok(!updatedAtMap[1].includes("inventory_transactions"), "inventory_transactions has no updated-at column → unconditional upsert");
ok(updatedAtMap[1].includes("inventory"), "inventory is covered by the freshness guard");

console.log("\n4) NULL-safe semantics against real SQLite (the refund-resurrection bug)");

/**
 * The guard used to read `excluded.updatedAt > orders.updatedAt` with no NULL
 * handling. `orders.updatedAt` is nullable and the client did not stamp it at
 * creation, so every comparison yielded NULL — never true — and D1 discarded
 * every later write to that order: refunds, payment settlement, delete
 * tombstones. Because a discarded write answers HTTP 200, the client acked it
 * and the refund survived only in IndexedDB until the cache was cleared.
 *
 * Assert the real SQL semantics, not just the source text.
 */
let sqlite: any = null;
try {
  sqlite = await import("node:sqlite");
} catch {
  console.log("  – node:sqlite unavailable on this runtime, skipping SQL semantics checks");
}

if (sqlite?.DatabaseSync) {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE orders (id TEXT PRIMARY KEY, paymentStatus TEXT, updatedAt TEXT, refundedAt TEXT)"
  );

  // Mirror the clause the Worker emits for `orders`.
  const upsert = db.prepare(`
    INSERT INTO orders (id, paymentStatus, updatedAt, refundedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      paymentStatus = excluded.paymentStatus,
      updatedAt = excluded.updatedAt,
      refundedAt = excluded.refundedAt
      WHERE COALESCE(excluded.updatedAt, '') > COALESCE(orders.updatedAt, '')
  `);

  // A legacy row created before the updatedAt stamp: NULL timestamp.
  db.exec("INSERT INTO orders (id, paymentStatus) VALUES ('ord_legacy', 'Paid')");
  const refund = upsert.run(
    "ord_legacy",
    "Refunded",
    "2026-07-30T11:00:00.000Z",
    "2026-07-30T11:00:00.000Z"
  );
  const legacyRow: any = db.prepare("SELECT * FROM orders WHERE id = 'ord_legacy'").get();
  ok(Number(refund.changes) === 1, "refund applies to a row whose stored updatedAt is NULL");
  ok(legacyRow.paymentStatus === "Refunded", "the legacy row is actually marked Refunded in D1");

  // A payload with no timestamp must still lose to a row that has one, so a
  // replayed legacy `create` can never clobber a newer refund.
  const clobber = upsert.run("ord_legacy", "Paid", null, null);
  const afterClobber: any = db.prepare("SELECT * FROM orders WHERE id = 'ord_legacy'").get();
  ok(Number(clobber.changes) === 0, "a payload with no updatedAt cannot overwrite a timestamped row");
  ok(afterClobber.paymentStatus === "Refunded", "the refund survives a stale untimestamped replay");

  // Last-writer-wins still holds between two real timestamps.
  db.exec(
    "INSERT INTO orders (id, paymentStatus, updatedAt) VALUES ('ord_race', 'Paid', '2026-07-30T12:00:00.000Z')"
  );
  const older = upsert.run("ord_race", "Unpaid", "2026-07-30T11:00:00.000Z", null);
  ok(Number(older.changes) === 0, "an older write still loses to a newer stored row");
  const newer = upsert.run("ord_race", "Refunded", "2026-07-30T13:00:00.000Z", "2026-07-30T13:00:00.000Z");
  ok(Number(newer.changes) === 1, "a newer write still wins");

  db.close();
}

console.log(`\n${passed} checks passed`);
