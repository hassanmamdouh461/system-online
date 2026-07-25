-- v7: performance indexes for the hot tables.
-- Safe additive migration (no DROP, no data change, no behaviour change).
--
-- Deliberately does NOT index branch_id. This is a single-branch system, so
-- every row carries the same branch_id value; such an index has near-zero
-- selectivity and would only cost write throughput and storage.
--
-- These are the columns actually used to filter and sort in the app.

-- Orders: date-range reporting (dashboard/reports), payment filtering
-- (receivables and revenue), tombstone checks on hydrate, and the phone/customer
-- lookups used at payment time.
CREATE INDEX IF NOT EXISTS idx_orders_created      ON orders(createdAt);
CREATE INDEX IF NOT EXISTS idx_orders_paystatus    ON orders(paymentStatus);
CREATE INDEX IF NOT EXISTS idx_orders_deleted      ON orders(deletedAt);
CREATE INDEX IF NOT EXISTS idx_orders_customer     ON orders(customerId);
CREATE INDEX IF NOT EXISTS idx_orders_customer_ph  ON orders(customerPhone);
CREATE INDEX IF NOT EXISTS idx_orders_company      ON orders(companyId);
-- Composite: "paid orders in this period" is the single most common report query.
CREATE INDEX IF NOT EXISTS idx_orders_status_date  ON orders(paymentStatus, createdAt);

-- Menu: QR/public menu and POS grid both exclude soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_menu_deleted        ON menu_items(deleted_at);

-- Customers: phone is the lookup key at the payment step.
CREATE INDEX IF NOT EXISTS idx_customers_phone     ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_company   ON customers(company_id);

-- Recipes: cost/COGS calculation joins on the inventory item.
CREATE INDEX IF NOT EXISTS idx_recipes_inventory   ON recipes(inventory_item_id);

-- Inventory transactions: history is read per item, newest first.
CREATE INDEX IF NOT EXISTS idx_inv_tx_created      ON inventory_transactions(created_at);

-- Incremental sync (?since=<ISO>) scans these columns.
CREATE INDEX IF NOT EXISTS idx_orders_updated      ON orders(updatedAt);
CREATE INDEX IF NOT EXISTS idx_menu_updated        ON menu_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_customers_updated   ON customers(updated_at);
