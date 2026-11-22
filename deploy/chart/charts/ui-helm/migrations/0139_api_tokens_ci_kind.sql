-- 0139_api_tokens_ci_kind: a repository's CI holds a stored token of kind `ci`, bound to the repository's GitHub numeric id (FR-078).

ALTER TABLE lore.repos ADD COLUMN IF NOT EXISTS github_id TEXT;
ALTER TABLE lore.repos ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE pipeline.api_tokens ADD COLUMN IF NOT EXISTS github_repo_id TEXT;
ALTER TABLE pipeline.api_tokens DROP CONSTRAINT IF EXISTS api_tokens_kind_check;
ALTER TABLE pipeline.api_tokens ADD CONSTRAINT api_tokens_kind_check CHECK (kind IN ('service', 'user', 'ci'));
