CREATE TABLE IF NOT EXISTS quiz_sessions (
  id text PRIMARY KEY, source text NOT NULL, source_id text NOT NULL,
  quiz_id text NOT NULL, version text NOT NULL, occurred_at timestamptz NOT NULL,
  started_at timestamptz, completed_at timestamptz, subject_key text,
  answers jsonb NOT NULL DEFAULT '{}', result_key text, result_url text,
  analytics_observed boolean NOT NULL DEFAULT false,
  email_consent boolean, consent_at timestamptz, contact_cipher text, contact_hash text,
  channel text, device text, is_test boolean NOT NULL DEFAULT false,
  raw_hash text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source,source_id)
);
CREATE INDEX IF NOT EXISTS quiz_sessions_range ON quiz_sessions(occurred_at,quiz_id,source);
CREATE INDEX IF NOT EXISTS quiz_sessions_contact ON quiz_sessions(contact_hash,completed_at DESC);
CREATE TABLE IF NOT EXISTS quiz_events (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES quiz_sessions(id),
  kind text NOT NULL, question_key text, occurred_at timestamptz NOT NULL,
  payload_hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS quiz_events_session ON quiz_events(session_id,kind,question_key);
CREATE TABLE IF NOT EXISTS quiz_configs (
  quiz_id text NOT NULL, version text NOT NULL, content jsonb NOT NULL,
  content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(quiz_id,version)
);
CREATE TABLE IF NOT EXISTS quiz_outbox (
  session_id text PRIMARY KEY REFERENCES quiz_sessions(id), state text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  profile_done boolean NOT NULL DEFAULT false,event_done boolean NOT NULL DEFAULT false,
  consent_done boolean NOT NULL DEFAULT false, last_error text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quiz_imports (
  file_hash text PRIMARY KEY, source text NOT NULL, file_name text NOT NULL,
  expected_count int NOT NULL, accepted_count int NOT NULL, rejected_count int NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quiz_source_coverage (
  quiz_id text NOT NULL, source text NOT NULL, from_at timestamptz NOT NULL,to_at timestamptz NOT NULL,
  file_hash text NOT NULL REFERENCES quiz_imports(file_hash),PRIMARY KEY(quiz_id,source,from_at,to_at),CHECK(to_at>from_at)
);
CREATE TABLE IF NOT EXISTS quiz_limits (key text PRIMARY KEY, n int NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS quiz_locks (key text PRIMARY KEY, token text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS quiz_orders (
  id text PRIMARY KEY,session_id text NOT NULL REFERENCES quiz_sessions(id),
  paid_at timestamptz NOT NULL,amount numeric(14,2) NOT NULL,currency text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS start_observed boolean NOT NULL DEFAULT false;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS completion_observed boolean NOT NULL DEFAULT false;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS response_flags jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS quiz_session_links (
  primary_id text NOT NULL REFERENCES quiz_sessions(id),
  duplicate_id text PRIMARY KEY REFERENCES quiz_sessions(id),
  match_method text NOT NULL,
  CHECK(primary_id<>duplicate_id)
);
CREATE TABLE IF NOT EXISTS quiz_reference_snapshots (
 id text PRIMARY KEY,quiz_id text NOT NULL,captured_at timestamptz NOT NULL,payload jsonb NOT NULL
);
ALTER TABLE quiz_events ADD COLUMN IF NOT EXISTS elapsed_ms integer;
