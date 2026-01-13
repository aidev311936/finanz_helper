-- Step 5: Budgets for categories (optional, set via chat)

CREATE TABLE IF NOT EXISTS budgets (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  category TEXT NOT NULL,
  monthly_limit NUMERIC(12,2) NOT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budgets_unique_token_category UNIQUE(token, category)
);

CREATE INDEX IF NOT EXISTS idx_budgets_token
  ON budgets(token);

CREATE TRIGGER trg_budgets_updated
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();
