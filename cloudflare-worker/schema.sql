-- D1 Schema for system-online POS Central Database
-- Union of all migrations (v2–v12). Provisioning from this file yields the
-- post-migration table shapes and indexes; do NOT re-run the individual
-- schema-migrate-v*.sql files against a database created from this file.

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  image TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT DEFAULT 'default',
  created_at TEXT,
  updated_at TEXT,
  -- Soft-delete tombstone. NULL = live; ISO string = deleted (hidden everywhere).
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  orderNumber TEXT NOT NULL,
  tableId TEXT NOT NULL,
  items TEXT NOT NULL,
  status TEXT NOT NULL,
  paymentStatus TEXT NOT NULL DEFAULT 'Unpaid',
  paymentMethod TEXT,
  totalAmount REAL NOT NULL,
  taxRate REAL,
  taxAmount REAL,
  grandTotal REAL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT,
  paidAt TEXT,
  customerPhone TEXT,
  customerId TEXT,
  customerName TEXT,
  companyId TEXT,
  companyName TEXT,
  billedToType TEXT,
  refundedAt TEXT,
  refundReason TEXT,
  -- Staff member (cashier/waiter) who took the order — shown on receipts and
  -- used to attribute sales per employee. Existing databases: schema-migrate-v13.sql.
  cashierName TEXT,
  -- Soft-delete tombstone. NULL = live; ISO string = deleted (hidden everywhere).
  deletedAt TEXT,
  branch_id TEXT DEFAULT 'default'
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Phone is intentionally NOT UNIQUE. The client (IndexedDB) uses a non-unique
  -- phone index and enforces "one account per phone" in code by reusing an
  -- existing id. A UNIQUE constraint here made the worker upsert (which targets
  -- ON CONFLICT(id) only) throw when two devices created the same phone under
  -- different ids, stalling that customer's sync and hiding its OnAccount
  -- receivables from the manager dashboard.
  -- Existing databases: see schema-migrate-v10.sql.
  phone TEXT NOT NULL,
  company_id TEXT,
  tags TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL,
  updated_at TEXT,
  branch_id TEXT DEFAULT 'default',
  -- Soft-delete tombstone. NULL = live; ISO string = deleted (hidden everywhere).
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tags TEXT,
  phone TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL,
  updated_at TEXT,
  branch_id TEXT DEFAULT 'default',
  -- Soft-delete tombstone. NULL = live; ISO string = deleted (hidden everywhere).
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock REAL NOT NULL DEFAULT 0,
  minStock REAL NOT NULL DEFAULT 0,
  costPerUnit REAL NOT NULL DEFAULT 0,
  branch_id TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Soft-delete tombstone. NULL = live; ISO string = deleted (hidden everywhere).
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  branch_id TEXT DEFAULT 'default',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT,
  branch_id TEXT DEFAULT 'default',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  item_name TEXT,
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT,
  reference_id TEXT,
  notes TEXT,
  branch_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT DEFAULT 'auto'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes (v7 performance set + v10 customer rebuild)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_created      ON orders(createdAt);
CREATE INDEX IF NOT EXISTS idx_orders_paystatus    ON orders(paymentStatus);
CREATE INDEX IF NOT EXISTS idx_orders_deleted      ON orders(deletedAt);
CREATE INDEX IF NOT EXISTS idx_orders_customer     ON orders(customerId);
CREATE INDEX IF NOT EXISTS idx_orders_customer_ph  ON orders(customerPhone);
CREATE INDEX IF NOT EXISTS idx_orders_company      ON orders(companyId);
CREATE INDEX IF NOT EXISTS idx_orders_status_date  ON orders(paymentStatus, createdAt);

CREATE INDEX IF NOT EXISTS idx_menu_deleted        ON menu_items(deleted_at);

CREATE INDEX IF NOT EXISTS idx_customers_phone     ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_company   ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_updated   ON customers(updated_at);

CREATE INDEX IF NOT EXISTS idx_recipes_inventory   ON recipes(inventory_item_id);

CREATE INDEX IF NOT EXISTS idx_inv_tx_created      ON inventory_transactions(created_at);

CREATE INDEX IF NOT EXISTS idx_orders_updated      ON orders(updatedAt);
CREATE INDEX IF NOT EXISTS idx_menu_updated        ON menu_items(updated_at);

CREATE INDEX IF NOT EXISTS idx_settings_branch     ON settings(branch_id);
CREATE INDEX IF NOT EXISTS idx_settings_key        ON settings(key);
CREATE INDEX IF NOT EXISTS idx_recipes_menu        ON recipes(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_item         ON inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_branch    ON snapshots(branch_id);
