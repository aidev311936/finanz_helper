-- 006_anon_rules.sql
-- Creates table for user-specific anonymization rules

CREATE TABLE IF NOT EXISTS anon_rules (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('regex')),
  pattern TEXT NOT NULL,
  flags TEXT NOT NULL DEFAULT 'gi',
  replacement TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT ux_anon_rules_user_name UNIQUE(token, name)
);

CREATE INDEX IF NOT EXISTS idx_anon_rules_token ON anon_rules(token, enabled);

CREATE TRIGGER trg_anon_rules_updated
  BEFORE UPDATE ON anon_rules
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();
