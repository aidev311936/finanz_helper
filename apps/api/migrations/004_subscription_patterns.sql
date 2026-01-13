-- Step 5: help grouping recurring payments (subscription_key)

ALTER TABLE masked_transactions
  ADD COLUMN IF NOT EXISTS subscription_key TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_score REAL;

CREATE INDEX IF NOT EXISTS idx_tx_token_subscription_key
  ON masked_transactions(token, subscription_key);
