-- 0135_user_session_tokens: store each web session's encrypted GitHub App
-- access and refresh token pair, keyed by the session's row in pipeline.api_tokens.

CREATE TABLE IF NOT EXISTS pipeline.user_session_tokens (
  token_id         UUID PRIMARY KEY REFERENCES pipeline.api_tokens (id) ON DELETE CASCADE,
  encrypted_tokens TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline.user_session_tokens TO lore;
