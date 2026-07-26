-- D1 Schema for system-online POS Central Database

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
  pointsEarned REAL,
  pointsRedeemed REAL,
  refundedAt TEXT,
  refundReason TEXT,
  -- Soft-delete tombstone. NULL = live; ISO string = deleted (hidden everywhere).
  deletedAt TEXT,
  branch_id TEXT DEFAULT 'default'
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  company_id TEXT,
  tags TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL,
  updated_at TEXT,
  branch_id TEXT DEFAULT 'default',
  -- Soft-delete tombstone. NULL = live; ISO string = deleted (hidden everywhere).
  -- Without it the client's tombstone upsert fails (no such column) on a fresh
  -- DB and deleted customers resurrect on sync, reviving stale loyalty points
  -- and OnAccount receivables. Matches schema-migrate-v9.
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
  -- Without it deleted companies resurrect on sync, reviving the OnAccount
  -- receivable ledgers attached to them. Matches schema-migrate-v9.
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
  -- Without it the client's tombstone upsert fails (no such column) on a fresh
  -- DB and deleted inventory items resurrect on sync. Matches schema-migrate-v8.
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

CREATE INDEX IF NOT EXISTS idx_settings_branch ON settings(branch_id);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
CREATE INDEX IF NOT EXISTS idx_recipes_menu ON recipes(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_item ON inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_branch ON snapshots(branch_id);
