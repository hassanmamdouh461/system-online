-- v5: menu soft-delete tombstones + timestamps
-- Safe additive migration (no DROP). Allows deleted menu items to stay marked
-- so they cannot be resurrected by cloud hydrate / snapshot restore.

ALTER TABLE menu_items ADD COLUMN deleted_at TEXT;
ALTER TABLE menu_items ADD COLUMN created_at TEXT;
ALTER TABLE menu_items ADD COLUMN updated_at TEXT;
