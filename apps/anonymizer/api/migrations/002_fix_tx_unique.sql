-- 002_fix_tx_unique.sql
-- Ensure ON CONFLICT (account_id, booking_hash) has a valid UNIQUE arbiter.
-- This migration is safe to run multiple times.

DO $$
BEGIN
  -- Drop legacy partial unique index if present
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='ux_tx_account_hash'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS ux_tx_account_hash';
  END IF;

  -- Add UNIQUE constraint if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ux_tx_account_hash_uc'
  ) THEN
    EXECUTE 'ALTER TABLE masked_transactions ADD CONSTRAINT ux_tx_account_hash_uc UNIQUE (account_id, booking_hash)';
  END IF;
END $$;
