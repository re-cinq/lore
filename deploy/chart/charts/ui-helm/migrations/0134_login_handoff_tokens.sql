-- 0134_login_handoff_tokens: store the encrypted GitHub App token pair in its
-- own column on lore.login_handoffs so grant_json stays token-free.

ALTER TABLE lore.login_handoffs
  ADD COLUMN IF NOT EXISTS encrypted_tokens TEXT;
