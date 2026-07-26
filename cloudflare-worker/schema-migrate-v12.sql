-- v12: round already-stored money values to the piaster (issue B.1 backfill).
--
-- WHAT WAS WRONG
-- Money was computed with raw JS floats and the drifted result was PERSISTED:
--
--     3 items x 33.33  ->  99.99000000000001
--     + 14% tax        -> 112.49999999999999   <-- this is what landed in D1
--
-- The UI hid it with .toFixed(2), so the screen said 112.50 while the stored
-- number was 112.49999999999999. Reports summed the stored (wrong) numbers, so
-- the cash drawer and the report disagreed by a few piasters and there was no
-- way to see why.
--
-- The application code is now fixed: src/utils/money.ts is the single place
-- money arithmetic happens, and the Worker rounds on both the write and read
-- boundary. This migration cleans up the rows written BEFORE that fix.
--
-- WHAT THIS DOES
-- Rounds every stored money column to 2 decimals (the piaster) using SQLite's
-- ROUND(). Data-only: no schema change, no DROP, no column added or removed.
--
--   orders.totalAmount   pre-tax subtotal
--   orders.taxAmount     frozen tax snapshot
--   orders.grandTotal    frozen total snapshot
--   menu_items.price     unit price (feeds every line total)
--   inventory.costPerUnit  unit cost (feeds COGS + valuation)
--
-- NOT touched (correctly):
--   orders.taxRate         a rate (0.14), not money — rounding it to 2dp would
--                          destroy rates like 0.145
--   inventory.stock,
--   inventory.minStock     quantities, not money
--
-- SAFETY
--   * Idempotent — ROUND() on an already-rounded value is a no-op, so running
--     this twice is harmless.
--   * NULL-safe — ROUND(NULL) is NULL, so a missing tax snapshot STAYS NULL.
--     This matters: coercing a NULL taxAmount/grandTotal to 0 is what used to
--     break revenue reporting after a restore. The WHERE clauses below also
--     skip NULLs explicitly.
--   * Only rewrites rows that actually need it (WHERE value <> ROUND(value)),
--     so updated_at churn and the write volume stay minimal.
--
-- ── BEFORE YOU RUN: take a backup ───────────────────────────────────────────
--   npx wrangler d1 export system-online-db --remote --output=backup-pre-v10.sql
--
-- ── DRY RUN FIRST (counts the rows that will change; changes nothing) ────────
--   npx wrangler d1 execute system-online-db --remote --command "SELECT 'orders.totalAmount' AS col, COUNT(*) AS drifted FROM orders WHERE totalAmount IS NOT NULL AND totalAmount <> ROUND(totalAmount, 2) UNION ALL SELECT 'orders.taxAmount', COUNT(*) FROM orders WHERE taxAmount IS NOT NULL AND taxAmount <> ROUND(taxAmount, 2) UNION ALL SELECT 'orders.grandTotal', COUNT(*) FROM orders WHERE grandTotal IS NOT NULL AND grandTotal <> ROUND(grandTotal, 2) UNION ALL SELECT 'menu_items.price', COUNT(*) FROM menu_items WHERE price IS NOT NULL AND price <> ROUND(price, 2) UNION ALL SELECT 'inventory.costPerUnit', COUNT(*) FROM inventory WHERE costPerUnit IS NOT NULL AND costPerUnit <> ROUND(costPerUnit, 2);"
--
-- ── APPLY ───────────────────────────────────────────────────────────────────
--   npx wrangler d1 execute system-online-db --remote --file=./schema-migrate-v10.sql
--
-- Deploy the fixed Worker + web bundle BEFORE running this, otherwise an
-- old client can immediately write a fresh drifted value back.
-- ────────────────────────────────────────────────────────────────────────────

-- Orders: the pre-tax subtotal.
UPDATE orders
   SET totalAmount = ROUND(totalAmount, 2)
 WHERE totalAmount IS NOT NULL
   AND totalAmount <> ROUND(totalAmount, 2);

-- Orders: the frozen tax snapshot. NULL stays NULL.
UPDATE orders
   SET taxAmount = ROUND(taxAmount, 2)
 WHERE taxAmount IS NOT NULL
   AND taxAmount <> ROUND(taxAmount, 2);

-- Orders: the frozen grand-total snapshot. NULL stays NULL.
UPDATE orders
   SET grandTotal = ROUND(grandTotal, 2)
 WHERE grandTotal IS NOT NULL
   AND grandTotal <> ROUND(grandTotal, 2);

-- Menu item unit prices — every line total is derived from these.
UPDATE menu_items
   SET price = ROUND(price, 2)
 WHERE price IS NOT NULL
   AND price <> ROUND(price, 2);

-- Inventory unit costs — COGS, margin and valuation are derived from these.
UPDATE inventory
   SET costPerUnit = ROUND(costPerUnit, 2)
 WHERE costPerUnit IS NOT NULL
   AND costPerUnit <> ROUND(costPerUnit, 2);

-- ── AFTER RUNNING: verify (every count must be 0) ───────────────────────────
--   npx wrangler d1 execute system-online-db --remote --command "SELECT COUNT(*) AS orders_drifted FROM orders WHERE (totalAmount IS NOT NULL AND totalAmount <> ROUND(totalAmount,2)) OR (taxAmount IS NOT NULL AND taxAmount <> ROUND(taxAmount,2)) OR (grandTotal IS NOT NULL AND grandTotal <> ROUND(grandTotal,2));"
--
-- Then check the invariant this whole issue is about — every order's stored
-- grandTotal must equal its own subtotal + tax, to the piaster. Expect 0 rows:
--   npx wrangler d1 execute system-online-db --remote --command "SELECT id, orderNumber, totalAmount, taxAmount, grandTotal, ROUND(COALESCE(totalAmount,0) + COALESCE(taxAmount,0), 2) AS expected FROM orders WHERE grandTotal IS NOT NULL AND taxAmount IS NOT NULL AND ROUND(grandTotal,2) <> ROUND(COALESCE(totalAmount,0) + COALESCE(taxAmount,0), 2) LIMIT 50;"
--
-- Any rows the last query DOES return are orders whose stored total never
-- matched its own parts (a pre-existing data problem this migration does not
-- invent a value for). Review them by hand before deciding to re-derive.
