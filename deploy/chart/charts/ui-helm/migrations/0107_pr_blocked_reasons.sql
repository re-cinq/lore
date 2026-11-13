-- 0107_pr_blocked_reasons: one row per open PR Lore watches, saying what blocks it (specs/protected-branch-merge).
-- closed_at is set when the PR merges or closes; the pr-blocked-reasons-prune sweep deletes a row 30 days after it.

CREATE TABLE IF NOT EXISTS pipeline.pr_blocked_reasons (
  repo        TEXT NOT NULL,
  pr_number   BIGINT NOT NULL,
  reason      TEXT NOT NULL,
  detail      TEXT,
  since       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ,
  PRIMARY KEY (repo, pr_number)
);

CREATE INDEX IF NOT EXISTS pr_blocked_reasons_closed_at_idx
  ON pipeline.pr_blocked_reasons (closed_at) WHERE closed_at IS NOT NULL;

GRANT ALL ON pipeline.pr_blocked_reasons TO lore;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.pr_blocked_reasons TO lore_ui';
  END IF;
END$$;
