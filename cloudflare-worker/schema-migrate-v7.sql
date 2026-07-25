-- ============================================================================
-- Migration v7 — Performance indexes on the hot tables.
--
-- Purely additive: no DROP, no ALTER, no data rewrite, no behaviour change.
-- Every statement is IF NOT EXISTS, so re-running this file is safe.
--
-- Why: the base schema only indexed `settings` and `snapshots`. Every read of
-- orders / menu_items / customers / inventory was a full table scan. On a shop
-- doing ~200 orders a day that is ~73k rows a year scanned on every report.
--
-- Apply with:
--   npx wrangler d1 execute system-online-db --remote --file=./schema-migrate-v7.sql
-- ============================================================================

-- Orders: the busiest table. Reports filter by date and payment state, and the
-- dashboard lists newest-first.
CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders(createdAt);
CREATE INDEX IF NOT EXISTS idx_orders_paystatus   ON orders(paymentStatus);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_updated     ON orders(updatedAt);
CREATE INDEX IF NOT EXISTS idx_orders_customer    ON orders(customerId);
CREATE INDEX IF NOT EXISTS idx_orders_company     ON orders(companyId);
-- Composite for the common "paid orders in a date range" revenue query.
CREATE INDEX IF NOT EXISTS idx_orders_pay_created ON orders(paymentStatus, createdAt);

-- Menu: loaded on every POS boot and by the public QR menu. deleted_at is
-- checked on every hydrate to avoid resurrecting removed items.
CREATE INDEX IF NOT EXISTS idx_menu_deleted       ON menu_items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_menu_category      ON menu_items(category);
CREATE INDEX IF NOT EXISTS idx_menu_updated       ON menu_items(updated_at);

-- Customers: phone is the lookup key at payment time.
-- (phone already has a UNIQUE constraint, which SQLite backs with an index —
--  these cover the other access paths.)
CREATE INDEX IF NOT EXISTS idx_customers_company  ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_updated  ON customers(updated_at);

-- Companies
CREATE INDEX IF NOT EXISTS idx_companies_updated  ON companies(updated_at);

-- Inventory + recipes: the stock screen and per-sale deduction path.
CREATE INDEX IF NOT EXISTS idx_inventory_updated  ON inventory(updated_at);
CREATE INDEX IF NOT EXISTS idx_recipes_inventory  ON recipes(inventory_item_id);

-- Inventory transaction log: read by date, and by the order that caused it.
CREATE INDEX IF NOT EXISTS idx_inv_tx_created     ON inventory_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_inv_tx_reference   ON inventory_transactions(reference_id);

-- Snapshots: pruning reads these newest-first.
CREATE INDEX IF NOT EXISTS idx_snapshots_created  ON snapshots(created_at);
