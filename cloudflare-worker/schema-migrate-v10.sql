-- ─────────────────────────────────────────────────────────────────────────────
-- Migration v10 — Server-side authentication
--
-- Moves the trust boundary from the browser to the Worker. Adds:
--   • auth_users      — server-verified credentials + authoritative roles
--   • login_attempts  — D1-backed rate limiting (Worker isolates do NOT share
--                       memory, so an in-process counter can't rate-limit).
--
-- Apply against BOTH the prod and web D1 databases, e.g.:
--   wrangler d1 execute <DB_NAME> --file=./schema-migrate-v10.sql
--   wrangler d1 execute <DB_NAME> --file=./schema-migrate-v10.sql --config wrangler-web.toml
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_users (
  username      TEXT PRIMARY KEY,            -- 'manager' | 'admin' (cashier)
  role          TEXT NOT NULL,               -- authoritative role; read from D1, never trusted from the client
  pass_hash     TEXT NOT NULL,               -- PBKDF2-HMAC-SHA256 derived bits (hex)
  pass_salt     TEXT NOT NULL,               -- per-user random salt (hex)
  iterations    INTEGER NOT NULL DEFAULT 210000,
  must_change   INTEGER NOT NULL DEFAULT 0,  -- force a password change on next login
  -- Revocation epoch (unix seconds). Any session token with iat < min_valid_iat
  -- is rejected, so "change password" / "log out everywhere" takes effect
  -- INSTANTLY (checked on every request via a cheap PK lookup).
  min_valid_iat INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT,
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key   TEXT PRIMARY KEY,            -- `${ip}:${username}`
  count         INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL DEFAULT 0   -- unix seconds marking the start of the current window
);

-- ─── Post-cutover cleanup (run MANUALLY once REQUIRE_SESSION_ONLY is enabled) ───
-- The browser used to mirror credential hashes into the generic settings table.
-- After every device has migrated to server-side auth, purge those rows so the
-- secrets no longer live in a client-readable collection:
--
--   DELETE FROM settings WHERE key IN (
--     'brewmaster_admin_creds_v2',
--     'brewmaster_manager_creds_v1',
--     'brewmaster_admin_pin'
--   );
--
-- (Left commented on purpose — do not drop credentials before cutover is confirmed.)
