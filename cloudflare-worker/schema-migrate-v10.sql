-- ─────────────────────────────────────────────────────────────────────────────
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
-- Column list
--   Exactly the 10 columns in the worker's own ALLOWED_COLUMNS.customers
--   (src/index.ts) — the authoritative contract for this table:
--     id, name, phone, company_id, tags, notes, createdAt, updated_at,
--     branch_id, deleted_at
--
--   Note `points` is deliberately NOT carried over. The loyalty feature was
--   removed and the worker explicitly strips it on read ("never surface a points
--   balance to clients, even if a legacy D1 row still carries the dormant
--   column"). Dropping it here finishes that removal. If your database predates
--   the removal and you want the values retained for offline analysis, export
--   `SELECT id, points FROM customers` BEFORE running this.
--
-- Safety
--   SQLite cannot DROP a column-level constraint in place, so this uses the
--   standard table-rebuild procedure, wrapped in a transaction: on ANY error the
--   whole migration rolls back and the original `customers` table is untouched.
--   There are no foreign keys referencing customers, so no PRAGMA dance is
--   needed.
--
--   ⚠️ This is the only migration in this repo that runs DROP TABLE. It is not
--   reversible. Export a backup first:
--     npx wrangler d1 export system-online-db --remote --output=pre-v10.sql
--
-- Prerequisite
--   v9 must already be applied (it adds customers.deleted_at, which the SELECT
--   below reads). Verify before running:
--     npx wrangler d1 execute system-online-db --remote \
--       --command="SELECT COUNT(*) FROM pragma_table_info('customers') WHERE name='deleted_at';"
--   Expect 1. If it returns 0, apply schema-migrate-v9.sql first.
--
-- Run ONCE, after v9:
--   npx wrangler d1 execute system-online-db --remote --file=./schema-migrate-v10.sql
--
-- Verify afterwards (expect the same row count as before, and no UNIQUE on phone):
--   npx wrangler d1 execute system-online-db --remote \
--     --command="SELECT COUNT(*) FROM customers;"
--   npx wrangler d1 execute system-online-db --remote \
--     --command="SELECT sql FROM sqlite_master WHERE name='customers';"
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN TRANSACTION;

CREATE TABLE customers_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,            -- was: phone TEXT UNIQUE NOT NULL
  company_id TEXT,
  tags TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL,
  updated_at TEXT,
  branch_id TEXT DEFAULT 'default',
  deleted_at TEXT
);

INSERT INTO customers_new (id, name, phone, company_id, tags, notes, createdAt, updated_at, branch_id, deleted_at)
  SELECT id, name, phone, company_id, tags, notes, createdAt, updated_at, branch_id, deleted_at
  FROM customers;

DROP TABLE customers;
ALTER TABLE customers_new RENAME TO customers;

-- Recreate the (non-unique) indexes originally added in v7.
CREATE INDEX IF NOT EXISTS idx_customers_phone   ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_updated ON customers(updated_at);

COMMIT;
