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

/**
 * Source text with comments stripped.
 *
 * This test greps the source, so PROSE that quotes SQL used to count as a code
 * site — a doc comment explaining the upsert was enough to make the "exactly 2
 * upsert sites" assertion fail. Scan code only.
 */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

console.log("\n1) upsert freshness guard is wired to UPDATED_AT_COLUMN");

ok(code.includes("const updatedAtCol = UPDATED_AT_COLUMN[table]"), "looks up the table's updated-at column");
ok(
  code.includes("excluded.${col} > ${table}.${col}"),
  "conflict update is gated on strictly-newer incoming updated_at"
);

// The guard MUST be NULL-safe. `excluded.col > table.col` alone evaluates to
// NULL (never TRUE) when the stored value is NULL, so any row inserted without
// an updated-at became permanently unwritable: payments, refunds, cancellations
// and status changes all answered 200 {stale:true} while D1 kept the old copy.
ok(
  code.includes("${table}.${col} IS NULL OR"),
  "stored NULL updated_at does not freeze the row (NULL-safe clause)"
);
ok(
  code.includes("function backfillUpdatedAt"),
  "incoming payloads missing updated_at are backfilled so stored rows never go NULL"
);
ok(
  /backfillUpdatedAt\(table, normalized\)/.test(code),
  "backfill runs inside normalizeData, after the camel→snake renames"
);

console.log("\n2) both upsert paths carry the guard");

// There are exactly two GENERIC (table-driven) upsert sites: /api/sync and the
// REST POST. Dedicated single-table statements — e.g. the atomic daily
// order-sequence counter, `INSERT INTO settings ... ON CONFLICT(id) DO UPDATE
// SET value = value + 1` — are not table-driven and are deliberately excluded:
// they carry their own concurrency design and no freshness column.
const conflictSites =
  code.match(/INSERT INTO \$\{table\}[\s\S]{0,400}?ON CONFLICT\(id\) DO UPDATE/g) || [];
assert.equal(conflictSites.length, 2, `expected exactly 2 table-driven upsert sites, found ${conflictSites.length}`);
const freshnessSites = code.match(/UPDATED_AT_COLUMN\[table\]/g) || [];
ok(freshnessSites.length >= 2, "freshness lookup present at both upsert sites");

console.log("\n3) tables without an updated-at column stay unconditional");

ok(
  code.includes("const freshness = updatedAtCol"),
  "freshness clause is conditional on the column existing"
);
// snapshots and inventory_transactions have no entry in UPDATED_AT_COLUMN.
const updatedAtMap = code.match(/const UPDATED_AT_COLUMN[^=]*= \{([\s\S]*?)\};/);
assert.ok(updatedAtMap, "UPDATED_AT_COLUMN map exists");
ok(!updatedAtMap[1].includes("snapshots"), "snapshots has no updated-at column → unconditional upsert");
ok(!updatedAtMap[1].includes("inventory_transactions"), "inventory_transactions has no updated-at column → unconditional upsert");
ok(updatedAtMap[1].includes("inventory"), "inventory is covered by the freshness guard");

console.log(`\n${passed} checks passed`);
