CREATE TABLE IF NOT EXISTS signed_request_nonces (
  key_id TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  request_timestamp TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key_id, nonce_hash)
);

CREATE INDEX IF NOT EXISTS signed_request_nonces_expires_idx
  ON signed_request_nonces (expires_at);

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS visibility_level TEXT NOT NULL DEFAULT 'summary'
  CHECK (visibility_level IN ('indicator', 'summary', 'full'));

CREATE INDEX IF NOT EXISTS actions_calendar_idx
  ON actions (due_at, owner_user_id, team_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS meetings_calendar_idx
  ON meetings (occurred_at, logged_by_user_id, team_id)
  WHERE deleted_at IS NULL;

INSERT INTO app_settings (key, value)
VALUES
  ('security.signedNonceTtlMinutes', '10'::jsonb),
  ('calendar.betaModel', '"meetings-and-actions"'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = NOW();
