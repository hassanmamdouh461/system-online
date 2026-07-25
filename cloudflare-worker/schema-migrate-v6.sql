-- v6: orders soft-delete tombstones
-- Safe additive migration (no DROP). Allows deleted orders to stay marked
-- so they cannot be resurrected by cloud hydrate / snapshot restore.

ALTER TABLE orders ADD COLUMN deletedAt TEXT;
