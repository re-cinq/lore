-- 0091_live_tokens: the browser's one live socket (ADR-048).
--
-- lore.live_tokens holds the short-lived tokens a browser opens one channel of
-- the live socket with — today a `run` channel for one assembly run. lore-api
-- mints one at the web tier's request after that tier has checked the person's
-- session and repo access, stores only its sha256, and verifies it when the
-- channel opens. Plan channels keep their own lore.plan_collab_tokens: the
-- Hocuspocus handshake inside the tunnel carries those.

CREATE TABLE IF NOT EXISTS lore.live_tokens (
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('run')),
  subject    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  user_name  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS live_tokens_expires
  ON lore.live_tokens (expires_at);
