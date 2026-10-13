-- 123-pr-blocked-reasons

CREATE TABLE IF NOT EXISTS pipeline.pr_blocked_reasons (
  repo        TEXT NOT NULL,
  pr_number   BIGINT NOT NULL,
  reason      TEXT NOT NULL,
  detail      TEXT,
  since       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, pr_number)
);

CREATE INDEX IF NOT EXISTS pr_blocked_reasons_updated_at_idx 
  ON pipeline.pr_blocked_reasons (updated_at);

GRANT ALL ON pipeline.pr_blocked_reasons TO lore;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.pr_blocked_reasons TO lore_ui';
  END IF;
END$$;
