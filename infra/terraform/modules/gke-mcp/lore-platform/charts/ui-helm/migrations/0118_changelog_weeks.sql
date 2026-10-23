-- 0118_changelog_weeks: one row per repo per finished ISO week (UTC) — what merged and closed that
-- week, and the introduction the weekly-changelog line's agent wrote about it (specs/repo-changelog).
-- Written once after the week ends; a by-hand rerun of the same week replaces its row.

CREATE TABLE IF NOT EXISTS lore.changelog_weeks (
  repo       TEXT        NOT NULL,
  week_key   TEXT        NOT NULL,
  intro      TEXT        NOT NULL DEFAULT '',
  changes    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  written_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, week_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON lore.changelog_weeks TO lore;
