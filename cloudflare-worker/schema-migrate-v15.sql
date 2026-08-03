-- Migration v15 — server-side atomic stock deltas (multi-tablet oversell fix)
--
-- WHY
-- ---
-- Stock deduction used to be computed on the tablet and pushed as a WHOLE row
-- (`cloudUpsert('inventory', id, { ...item, stock: absoluteValue })`). The
-- worker's freshness guard only rejects writes with an OLDER updated_at — it
-- cannot merge two concurrent deltas. So two tills selling the same ingredient
-- at the same moment both read stock=10, computed 10-3 and 10-4, and pushed
-- absolute 7 and 6; the later timestamp won and the shop was left with 6
-- instead of 3. Stock silently overstated on every concurrent sale, which means
-- overselling ingredients that are physically gone.
--
-- The fix moves the arithmetic to D1: the client sends a signed DELTA and the
-- worker applies `stock = MAX(0, stock + delta)` in ONE statement. Concurrent
-- deltas then compose instead of clobbering.
--
-- This table exists purely for IDEMPOTENCY. A delta is not safe to retry
-- blindly: if the response is lost to a flaky tablet connection, replaying the
-- request would deduct twice. Each delta carries a client-generated, stable
-- `op_id`; the insert below is bundled with the stock UPDATE in one D1 batch
-- (a transaction), so a replayed op_id hits the PRIMARY KEY, the whole batch
-- rolls back, and the stock is left untouched.

CREATE TABLE IF NOT EXISTS stock_delta_ops (
  -- Client-generated and STABLE across retries of the same logical deduction.
  op_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  delta REAL NOT NULL,
  -- Stock value AFTER this op was applied — lets a retry return the same
  -- authoritative answer it would have returned the first time.
  resulting_stock REAL,
  reference_id TEXT,
  branch_id TEXT,
  created_at TEXT NOT NULL
);

-- Retention sweep + "has this op already run" lookups.
CREATE INDEX IF NOT EXISTS idx_stock_delta_ops_created ON stock_delta_ops(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_delta_ops_item ON stock_delta_ops(item_id);
