-- 0137_api_tokens_github_id: the GitHub numeric id of the person a web session or a minted token speaks for, so a removal from the org can find every token and session of theirs (FR-044).

ALTER TABLE pipeline.api_tokens ADD COLUMN IF NOT EXISTS github_id BIGINT;
CREATE INDEX IF NOT EXISTS api_tokens_github_id_idx ON pipeline.api_tokens (github_id) WHERE github_id IS NOT NULL;
