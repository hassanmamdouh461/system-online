-- Clear every business record from D1, leaving the schema and the login
-- credentials intact. This is the handover script: run it once before giving
-- the system to a new operator so they start on their own data instead of
-- inheriting the previous shop's orders, customers and menu.
--
--   cd cloudflare-worker
--   npx wrangler d1 execute system-online-db --remote --file=./reset-business-data.sql
--
-- TAKE A BACKUP FIRST — this is not reversible from inside the app:
--   npx wrangler d1 export system-online-db --remote --output=backup.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A SQL SCRIPT AND NOT THE APP
--
-- There is no bulk-delete endpoint on the Worker, and `orders` refuses DELETE
-- for every role including manager (permissions.ts, "Invoices are never
-- deleted" — a refund voids a sale, it does not erase it). That rule is correct
-- for day-to-day operation and wrong for a handover, so the handover happens
-- underneath the Worker rather than by weakening the rule.
--
-- AFTER RUNNING THIS, ALSO CLEAR EACH DEVICE. Every till keeps a full copy in
-- IndexedDB plus a pending sync queue; a device that still holds the old rows
-- will happily push them back up. On each browser that was used with the POS:
--   DevTools → Application → Storage → Clear site data.
-- ─────────────────────────────────────────────────────────────────────────────

-- Sales and the ledgers derived from them.
DELETE FROM orders;
DELETE FROM inventory_transactions;
DELETE FROM stock_delta_ops;

-- Catalog, stock and the recipes that link them.
DELETE FROM recipes;
DELETE FROM menu_items;
DELETE FROM inventory;

-- Customer book.
DELETE FROM customers;
DELETE FROM companies;

-- Full-system backups. These MUST go: restoreFromSnapshotIfNeeded pulls the
-- latest snapshot onto any device that boots with an empty database, so leaving
-- them behind means the new operator's first login silently restores the old
-- shop's data over their fresh install.
DELETE FROM snapshots;

-- Auth bookkeeping — sign-in history, not configuration.
DELETE FROM login_attempts;
DELETE FROM auth_users;

-- Settings: drop the previous shop's configuration and the accumulated
-- rate-limiter rows (one per visitor IP, written by the session-mint limiter and
-- never cleaned up), but KEEP the two credential rows so the system stays
-- loginable. Rotate the passwords separately — see scripts/seed-manager-credential.mjs.
DELETE FROM settings
WHERE key NOT IN ('brewmaster_manager_creds_v1', 'brewmaster_admin_creds_v2');
