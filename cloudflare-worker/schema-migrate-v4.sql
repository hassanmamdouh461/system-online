-- v4: order account / company billing fields for OnAccount ledgers
-- Safe additive migration (no DROP)

ALTER TABLE orders ADD COLUMN updatedAt TEXT;
ALTER TABLE orders ADD COLUMN customerId TEXT;
ALTER TABLE orders ADD COLUMN customerName TEXT;
ALTER TABLE orders ADD COLUMN companyId TEXT;
ALTER TABLE orders ADD COLUMN companyName TEXT;
ALTER TABLE orders ADD COLUMN billedToType TEXT;
ALTER TABLE orders ADD COLUMN refundedAt TEXT;
ALTER TABLE orders ADD COLUMN refundReason TEXT;
