-- v9: customers + companies soft-delete tombstones.
-- Safe additive migration (no DROP, no data change).
--
-- customers and companies were hard-deleted, so a delete on one device did not
-- propagate: any other device (or a stale snapshot, or a slow sync) that pushed
-- an UPDATE for the same id resurrected the deleted customer — bringing back
-- stale loyalty points and old OnAccount receivable ledgers attached to it.
-- This matches the inventory.deleted_at (v8) and menu_items.deleted_at (v5)
-- pattern: a tombstone column lets the delete persist in D1 so every device
-- learns the record was removed and stops resurrecting it on hydrate/sync.

ALTER TABLE customers ADD COLUMN deleted_at TEXT;
ALTER TABLE companies ADD COLUMN deleted_at TEXT;
