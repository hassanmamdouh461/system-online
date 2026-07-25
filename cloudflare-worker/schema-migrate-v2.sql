-- Safe additive migration (no DROP) for existing D1 databases
-- Run against existing D1: wrangler d1 execute system-online-db --remote --file=./schema-migrate-v2.sql

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tags TEXT,
  phone TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL,
  updated_at TEXT,
  branch_id TEXT DEFAULT 'default'
);

-- Order financial snapshot columns (critical for durable revenue after browser wipe)
-- SQLite: re-running ALTER on existing column will error — run once or ignore errors.
ALTER TABLE orders ADD COLUMN taxRate REAL;
ALTER TABLE orders ADD COLUMN taxAmount REAL;
ALTER TABLE orders ADD COLUMN grandTotal REAL;

-- Optional extras if missing on older DBs:
-- ALTER TABLE customers ADD COLUMN company_id TEXT;
-- ALTER TABLE customers ADD COLUMN tags TEXT;
-- ALTER TABLE customers ADD COLUMN notes TEXT;
-- ALTER TABLE customers ADD COLUMN updated_at TEXT;
-- ALTER TABLE orders ADD COLUMN customerPhone TEXT;
-- ALTER TABLE orders ADD COLUMN pointsEarned REAL;
-- ALTER TABLE orders ADD COLUMN pointsRedeemed REAL;
