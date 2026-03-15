-- Step 4: enrichment columns for better merchant/subscription analytics

ALTER TABLE masked_transactions
  ADD COLUMN IF NOT EXISTS merchant_normalized TEXT,
  ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN,
  ADD COLUMN IF NOT EXISTS subscription_period TEXT,
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN,
  ADD COLUMN IF NOT EXISTS enriched_json JSONB;

CREATE INDEX IF NOT EXISTS idx_tx_token_merchant
  ON masked_transactions(token, merchant_normalized);

CREATE INDEX IF NOT EXISTS idx_tx_token_is_subscription
  ON masked_transactions(token, is_subscription);

CREATE INDEX IF NOT EXISTS idx_tx_token_is_recurring
  ON masked_transactions(token, is_recurring);
