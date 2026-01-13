CREATE TABLE IF NOT EXISTS user_tokens (
  token TEXT PRIMARY KEY,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  accessed_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  alias TEXT NOT NULL,
  handle TEXT NOT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_unique_handle UNIQUE(token, handle)
);

CREATE INDEX IF NOT EXISTS idx_accounts_token_bank ON accounts(token, bank_name);

CREATE TABLE IF NOT EXISTS imports (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  tx_count INTEGER NOT NULL DEFAULT 0,
  first_booking_date_iso TIMESTAMPTZ,
  last_booking_date_iso TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_imports_token_created ON imports(token, created_on DESC);

CREATE TABLE IF NOT EXISTS masked_transactions (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  import_id BIGINT REFERENCES imports(id) ON DELETE SET NULL,

  bank_name TEXT,

  booking_date TEXT,
  booking_date_raw TEXT,
  booking_date_iso TIMESTAMPTZ,

  booking_text TEXT,
  booking_type TEXT,

  booking_amount TEXT,
  booking_amount_value NUMERIC(12,2),

  booking_hash TEXT,

  booking_category TEXT,
  category_confidence REAL,
  category_source TEXT,

  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_account_hash
  ON masked_transactions(account_id, booking_hash)
  WHERE booking_hash IS NOT NULL AND booking_hash <> '';

CREATE INDEX IF NOT EXISTS idx_tx_token_date ON masked_transactions(token, booking_date_iso DESC);
CREATE INDEX IF NOT EXISTS idx_tx_token_category ON masked_transactions(token, booking_category);

CREATE TABLE IF NOT EXISTS bank_mapping (
  id BIGSERIAL PRIMARY KEY,
  bank_name TEXT NOT NULL UNIQUE,
  booking_date TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  amount TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  booking_text TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  booking_type TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  booking_date_parse_format TEXT NOT NULL DEFAULT '',
  without_header BOOLEAN NOT NULL DEFAULT FALSE,
  detection_hints JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_format_requests (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_token_created ON chat_messages(token, created_on DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status, run_after);

CREATE TABLE IF NOT EXISTS _migrations(
  id TEXT PRIMARY KEY,
  applied_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_row_updated_on()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_on = now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_accounts_updated
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();

CREATE TRIGGER trg_imports_updated
  BEFORE UPDATE ON imports
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();

CREATE TRIGGER trg_tx_updated
  BEFORE UPDATE ON masked_transactions
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();

CREATE TRIGGER trg_bank_mapping_updated
  BEFORE UPDATE ON bank_mapping
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();

CREATE TRIGGER trg_jobs_updated
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();

-- Seed: a generic 4-column mapping (no header) for quick testing
-- CSV columns: 1=date, 2=text, 3=type, 4=amount
INSERT INTO bank_mapping(
  bank_name,
  booking_date,
  amount,
  booking_text,
  booking_type,
  booking_date_parse_format,
  without_header,
  detection_hints
)
VALUES (
  'generic_4col',
  ARRAY['$1'],
  ARRAY['$4'],
  ARRAY['$2'],
  ARRAY['$3'],
  'dd.MM.yyyy',
  TRUE,
  '{"without_header": {"column_count": 4, "column_markers": ["date","text","text","number"]}}'::jsonb
)
ON CONFLICT (bank_name) DO NOTHING;
