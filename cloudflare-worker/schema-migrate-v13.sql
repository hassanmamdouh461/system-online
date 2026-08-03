-- v13: staff attribution on orders (cashier / waiter name on every invoice).
--
-- WHY
-- The POS now lets the operator pick WHO took the order (a staff member selected
-- on the cashier screen) and that name is printed on the receipt so management
-- can attribute each sale to the right person. The value travels with the order
-- document through the normal sync path, so D1 needs a column to hold it.
--
-- WHAT THIS DOES
--   orders.cashierName  TEXT, nullable — free-form staff display name.
--
-- SAFETY
--   * Additive only — no existing column or row is touched.
--   * NULL-safe — old orders simply have no staff attribution.
--   * Idempotent — guard check means running this twice is a no-op.
--
-- APPLY (same way as previous migrations):
--   npx wrangler d1 execute <DATABASE_NAME> --remote --file=schema-migrate-v13.sql

ALTER TABLE orders ADD COLUMN cashierName TEXT;
