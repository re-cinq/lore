-- 0121_user_sessions: a person signed in through lore-api's GitHub login holds a
-- `user` token row (8 h) that carries who they are and which org repos they can
-- read; lore.login_handoffs holds the one-time OAuth state and redeem codes.

ALTER TABLE pipeline.api_tokens ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'service';
ALTER TABLE pipeline.api_tokens DROP CONSTRAINT IF EXISTS api_tokens_kind_check;
ALTER TABLE pipeline.api_tokens ADD CONSTRAINT api_tokens_kind_check CHECK (kind IN ('service', 'user'));
ALTER TABLE pipeline.api_tokens ADD COLUMN IF NOT EXISTS login TEXT;
ALTER TABLE pipeline.api_tokens ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE pipeline.api_tokens ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE pipeline.api_tokens ADD COLUMN IF NOT EXISTS repos TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS lore.login_handoffs (
  code_hash  TEXT PRIMARY KEY,
  phase      TEXT NOT NULL CHECK (phase IN ('state', 'redeem')),
  return_url TEXT NOT NULL,
  grant_json JSONB,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS login_handoffs_expires ON lore.login_handoffs (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON lore.login_handoffs TO lore;
