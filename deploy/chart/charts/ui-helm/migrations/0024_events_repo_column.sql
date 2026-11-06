-- 0024_events_repo_column: promote the per-event repo from the JSONB payload to a
-- first-class column.
--
-- 0023 stored the owning repo only inside `params` (`params->>'repo'`), so "events
-- for a repo" (the web-ui repo Overview "Latest Events" section + the /events view)
-- was a JSONB scan with no index. This adds a real `repo` column, backfills it from
-- the payload, and indexes it newest-first. github.* / internal.* events carry
-- `params.repo`; org-wide cron.* and task-keyed kubernetes.* events don't, so `repo`
-- stays NULL for those (the partial index skips them too).
--
-- Both producers (`@re-cinq/lore-shared` insertEvent + the Floor's main-loop store)
-- now populate the column via `eventRepo(params)`. The `pipeline` schema is owned by
-- `lore` (the migration runner), so ALTER applies through the normal channel.
-- Idempotent: safe to re-run.

ALTER TABLE pipeline.events ADD COLUMN IF NOT EXISTS repo TEXT;

-- Backfill existing rows from the JSONB payload.
UPDATE pipeline.events
   SET repo = params->>'repo'
 WHERE repo IS NULL AND params->>'repo' IS NOT NULL;

-- Repo-scoped lookups, newest-first (the web-ui events list query).
CREATE INDEX IF NOT EXISTS events_repo_idx
  ON pipeline.events(repo, captured_at DESC) WHERE repo IS NOT NULL;
