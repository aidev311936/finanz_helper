-- Add soft delete to anon_rules table
ALTER TABLE anon_rules 
ADD COLUMN IF NOT EXISTS deleted_on TIMESTAMPTZ DEFAULT NULL;

-- Index for filtering active rules
CREATE INDEX IF NOT EXISTS idx_anon_rules_active 
ON anon_rules(token, deleted_on) 
WHERE deleted_on IS NULL;

-- Add anonymization tracking to masked_transactions
ALTER TABLE masked_transactions
ADD COLUMN IF NOT EXISTS applied_rules BIGINT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS anonymity_status TEXT DEFAULT 'dont_care'
CHECK (anonymity_status IN ('dont_care', 'anonymized', 'already_anonymous'));

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_masked_tx_status 
ON masked_transactions(anonymity_status);

-- Index for applied rules (GIN for array operations)
CREATE INDEX IF NOT EXISTS idx_masked_tx_applied_rules 
ON masked_transactions USING GIN(applied_rules);
