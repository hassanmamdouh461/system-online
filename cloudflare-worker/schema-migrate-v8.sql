-- v8: inventory soft-delete tombstones.
-- Safe additive migration (no DROP, no data change).
--
-- inventory was the only soft-deletable table without a tombstone column. The
-- front-end already writes a local `deletedAt` tombstone and cloudHydrate already
-- reads `doc.deleted_at || doc.deletedAt` to prevent resurrecting deleted items —
-- but the column never existed in D1, so the tombstone upsert silently failed
-- (NOT NULL on unit/minStock/costPerUnit/created_at, plus `deletedAt` was not an
-- allowed column). The hard cloud DELETE was the only thing that removed the row,
-- and it does not propagate: any other device (or a stale snapshot, or a slow
-- sync) that pushes an UPDATE for the same id resurrects the deleted item.
-- This column lets the tombstone persist in D1 so every device learns the item
-- was deleted, matching how menu_items.deleted_at already works.

ALTER TABLE inventory ADD COLUMN deleted_at TEXT;
