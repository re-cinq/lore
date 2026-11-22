-- 0140_user_session_token_expiries: the expiry of each stored access token and refresh token, on the row that holds the pair, so lore-api can refresh a token before it lapses (FR-220, FR-221, FR-222). The sign-in handoff carries both from the callback to the redeem.

ALTER TABLE pipeline.user_session_tokens
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ;

ALTER TABLE lore.login_handoffs
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ;
