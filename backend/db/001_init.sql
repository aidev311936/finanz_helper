-- Datenbankschema für Finanz Helper Wizard

-- Tabelle für Benutzertokens und Einstellungen (wie im Umsatz‑Anonymizer)
CREATE TABLE IF NOT EXISTS user_tokens (
  token TEXT PRIMARY KEY,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  accessed_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabelle für anonymisierte/pseudonymisierte Transaktionen
CREATE TABLE IF NOT EXISTS masked_transactions (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  bank_name TEXT,
  booking_date TEXT,
  booking_date_raw TEXT,
  booking_date_iso TIMESTAMPTZ,
  booking_text TEXT,
  booking_type TEXT,
  booking_amount TEXT,
  booking_account TEXT,
  booking_hash TEXT,
  booking_category TEXT,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index für schnelle Suche nach booking_hash
CREATE INDEX IF NOT EXISTS idx_masked_transactions_booking_hash
  ON masked_transactions(booking_hash);

-- Tabelle für Bank‑Mappings und Parserdefinitionen
CREATE TABLE IF NOT EXISTS bank_mapping (
  id BIGSERIAL PRIMARY KEY,
  bank_name TEXT NOT NULL,
  booking_date TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  amount TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  booking_text TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  booking_type TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  booking_date_parse_format TEXT NOT NULL DEFAULT '',
  without_header BOOLEAN NOT NULL DEFAULT FALSE,
  detection_hints JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bank_mapping_unique_bank UNIQUE (bank_name)
);

-- Neue Tabellen für Wizard‑Runs, Workspaces und Import‑Batches

-- Jeder Wizard‑Run gehört zu einem Workspace und optional zu einem Token. Er speichert den aktuellen Schritt und den UI‑State.
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_batches (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  token TEXT REFERENCES user_tokens(token),
  bank_name TEXT,
  account_alias TEXT,
  source_filename TEXT,
  row_count INT,
  started_on TIMESTAMPTZ,
  finished_on TIMESTAMPTZ,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wizard_runs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  token TEXT REFERENCES user_tokens(token),
  current_step INT NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Zusätzliche optionale Spalten für masked_transactions
ALTER TABLE masked_transactions ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE masked_transactions ADD COLUMN IF NOT EXISTS import_batch_id BIGINT;
ALTER TABLE masked_transactions ADD COLUMN IF NOT EXISTS account_alias TEXT;
ALTER TABLE masked_transactions ADD COLUMN IF NOT EXISTS merchant_key TEXT;
ALTER TABLE masked_transactions ADD COLUMN IF NOT EXISTS is_income BOOLEAN;
ALTER TABLE masked_transactions ADD COLUMN IF NOT EXISTS currency TEXT;
