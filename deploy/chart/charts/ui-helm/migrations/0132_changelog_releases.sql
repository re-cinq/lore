-- 0132_changelog_releases: one row per repo per published release of a private repository's main
-- branch to its public mirror. A rerun of the same version replaces the row but keeps the claim on
-- its Slack announcement.

CREATE TABLE IF NOT EXISTS lore.changelog_releases (
  repo         TEXT        NOT NULL,
  version      TEXT        NOT NULL,
  previous_tag TEXT,
  sha          TEXT        NOT NULL,
  bump         TEXT        NOT NULL CHECK (bump IN ('major', 'minor', 'patch')),
  range_from   TIMESTAMPTZ,
  range_to     TIMESTAMPTZ NOT NULL,
  summary      TEXT        NOT NULL DEFAULT '',
  changes      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  release_url  TEXT,
  published_to TEXT,
  announced_at TIMESTAMPTZ,
  slack_ts     TEXT,
  written_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON lore.changelog_releases TO lore;
