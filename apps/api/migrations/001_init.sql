-- 001_init.sql

CREATE TABLE IF NOT EXISTS user_tokens (
  token TEXT PRIMARY KEY,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  accessed_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Konten pro User/Token
CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  alias TEXT NOT NULL,                -- was der User sieht: "Hauptkonto"
  handle TEXT NOT NULL,               -- stable, KI-tauglich: "acc_1", "acc_2"
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_unique_handle UNIQUE(token, handle)
);

CREATE INDEX IF NOT EXISTS idx_accounts_token_bank
  ON accounts(token, bank_name);

-- Import-„Batch“ (optional aber hilfreich für UX/Progress)
CREATE TABLE IF NOT EXISTS imports (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  tx_count INTEGER NOT NULL DEFAULT 0,
  first_booking_date_iso TIMESTAMPTZ,
  last_booking_date_iso TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_imports_token_created
  ON imports(token, created_on DESC);

-- Deine anonymisierten Umsätze
CREATE TABLE IF NOT EXISTS masked_transactions (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  import_id BIGINT REFERENCES imports(id) ON DELETE SET NULL,

  bank_name TEXT,
  booking_date_raw TEXT,
  booking_date_iso TIMESTAMPTZ,

  booking_text TEXT,                  -- anonymisiert
  booking_type TEXT,

  booking_amount_raw TEXT,            -- original (anonymisiert/clean)
  booking_amount_value NUMERIC(12,2), -- für SQL-Queries (teuerstes etc.)

  booking_hash TEXT,                  -- aus Browser berechnet (stable!)
  booking_category TEXT,              -- von KI befüllt
  category_confidence REAL,
  category_source TEXT,               -- 'llm' | 'user' | 'rule'

  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- dedupe pro Konto über hash
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_account_hash
  ON masked_transactions(account_id, booking_hash)
  WHERE booking_hash IS NOT NULL AND booking_hash <> '';

CREATE INDEX IF NOT EXISTS idx_tx_token_date
  ON masked_transactions(token, booking_date_iso DESC);

CREATE INDEX IF NOT EXISTS idx_tx_token_category
  ON masked_transactions(token, booking_category);

-- Bank-Configs (intern gepflegt, keine UI)
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

-- Wenn Bank nicht erkannt: Support-Anfrage nur mit Bankname
CREATE TABLE IF NOT EXISTS bank_format_requests (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_format_requests_created
  ON bank_format_requests(created_on DESC);

-- Chat Messages (roh gespeichert)
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_token_created
  ON chat_messages(token, created_on DESC);

-- Jobs (Postgres Queue, kein Redis)
CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  type TEXT NOT NULL,                 -- 'categorize_import' | ...
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

CREATE INDEX IF NOT EXISTS idx_jobs_ready
  ON jobs(status, run_after);

-- updated_on trigger (wie in deinem repo1)
CREATE OR REPLACE FUNCTION set_row_updated_on()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_on = now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_accounts_updated
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();

CREATE TRIGGER trg_tx_updated
  BEFORE UPDATE ON masked_transactions
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();

CREATE TRIGGER trg_imports_updated
  BEFORE UPDATE ON imports
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();

CREATE TRIGGER trg_bank_mapping_updated
  BEFORE UPDATE ON bank_mapping
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();

CREATE TRIGGER trg_jobs_updated
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_on();
