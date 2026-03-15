-- Sparbot: User-Profil und Chatverlauf
-- ============================================================

CREATE TABLE IF NOT EXISTS sparbot_profiles (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE REFERENCES user_tokens(token) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  formality TEXT NOT NULL DEFAULT 'du'
    CHECK (formality IN ('du', 'sie')),
  transaction_summary JSONB DEFAULT NULL,
  summary_updated_on TIMESTAMPTZ DEFAULT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sparbot_messages (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content JSONB NOT NULL,
  selected_action TEXT DEFAULT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sparbot_msg_token
  ON sparbot_messages(token, created_on DESC);

CREATE TABLE IF NOT EXISTS sparbot_usage (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES user_tokens(token) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  request_count INT NOT NULL DEFAULT 0,
  UNIQUE(token, usage_date)
);
