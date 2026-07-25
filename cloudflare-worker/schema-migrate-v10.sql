-- v10: drop the UNIQUE constraint on customers.phone.
--
-- Why this is a bug
--   The client (IndexedDB) deliberately uses a NON-UNIQUE phone index
--   (repositories/indexeddb/db.ts, DB_VERSION 5: "customers phone index
--   non-unique") and enforces "one account per phone" in code by reusing an
--   existing id when the phone already exists locally. D1, however, still
--   declared `phone TEXT UNIQUE NOT NULL`.
--
--   The worker upsert only targets ON CONFLICT(id). It does NOT handle a phone
--   collision. So when two tablets create the SAME phone as a brand-new customer
--   (different ids) before either has hydrated the other's row, the second row's
--   INSERT ... ON CONFLICT(id) hits the UNIQUE(phone) constraint, the worker
--   returns 500, and that customer's sync retries with backoff and then dies
--   (SyncService MAX_ATTEMPTS). The customer keeps working locally but never
--   reaches D1 — and any OnAccount receivable attached to it never reaches the
--   manager dashboard, so central receivables are under-reported (silent loss).
--
-- Fix
--   Rebuild `customers` without the UNIQUE(phone) constraint so D1 matches the
--   client's design. Uniqueness stays enforced in code by the client's
--   phone-based dedup; D1 simply stops crashing (and stalling sync) on a
--   duplicate phone.
--
-- Safety
--   SQLite cannot DROP a column-level constraint in place, so this uses the
--   standard table-rebuild procedure, wrapped in a transaction: on ANY error the
--   whole migration rolls back and the original `customers` table is untouched.
--   There are no foreign keys referencing customers, so no PRAGMA dance is
--   needed. Column list is identical to schema.sql (post-v9) MINUS the UNIQUE.
--
-- Run ONCE, after v9, ideally right after exporting a backup:
--   npx wrangler d1 execute system-online-db --remote --file=./schema-migrate-v10.sql

BEGIN TRANSACTION;

CREATE TABLE customers_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,            -- was: phone TEXT UNIQUE NOT NULL
  points REAL NOT NULL DEFAULT 0,
  company_id TEXT,
  tags TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL,
  updated_at TEXT,
  branch_id TEXT DEFAULT 'default',
  deleted_at TEXT
);

INSERT INTO customers_new (id, name, phone, points, company_id, tags, notes, createdAt, updated_at, branch_id, deleted_at)
  SELECT id, name, phone, points, company_id, tags, notes, createdAt, updated_at, branch_id, deleted_at
  FROM customers;

DROP TABLE customers;
ALTER TABLE customers_new RENAME TO customers;

-- Recreate the (non-unique) indexes originally added in v7.
CREATE INDEX IF NOT EXISTS idx_customers_phone   ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_updated ON customers(updated_at);

COMMIT;
