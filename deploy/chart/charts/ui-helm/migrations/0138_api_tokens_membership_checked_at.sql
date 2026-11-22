-- 0138_api_tokens_membership_checked_at: when GitHub last said its maker is still an active member of the org, so a minted token is checked again once the answer is five minutes old (FR-045).

ALTER TABLE pipeline.api_tokens ADD COLUMN IF NOT EXISTS membership_checked_at TIMESTAMPTZ;
