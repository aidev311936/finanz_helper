-- 005_fix_tx_unique_index.sql
-- Ensure ON CONFLICT (account_id, booking_hash) works by having a non-partial unique index.
-- Also backfills legacy rows with empty hashes to avoid unique violations.

BEGIN;

-- Backfill empty / null hashes with a deterministic unique value based on row id (legacy safeguard).
UPDATE masked_transactions
SET booking_hash = 'legacy_' || id::text
WHERE booking_hash IS NULL OR booking_hash = '';

-- Drop legacy partial index if present
DROP INDEX IF EXISTS ux_tx_account_hash;

-- Create correct unique index (non-partial) used by ON CONFLICT (account_id, booking_hash)
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_account_hash
  ON masked_transactions(account_id, booking_hash);

COMMIT;
