-- 0136_api_tokens_repos_refreshed_at: when a web session's kept repository list was last read in full from GitHub (FR-032, FR-039, FR-140).

ALTER TABLE pipeline.api_tokens ADD COLUMN IF NOT EXISTS repos_refreshed_at TIMESTAMPTZ;
UPDATE pipeline.api_tokens SET repos_refreshed_at = created_at WHERE repos_refreshed_at IS NULL;
