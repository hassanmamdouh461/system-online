-- D1 migration v3: settings, recipes, inventory_transactions, snapshots
-- Safe additive (CREATE IF NOT EXISTS). Run:
--   npx wrangler d1 execute system-online-db --remote --file=./schema-migrate-v3.sql

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
