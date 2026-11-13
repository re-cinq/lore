-- 0001_lore_settings: org-wide key-value settings table.
--
-- Read/written by the web-ui settings page (SELECT key, value, updated_at FROM
-- lore.settings) and agent/src/approval.ts. Defined in setup-repos-schema.sh,
-- but databases provisioned before that table was added to the script are
-- missing it — which 500s the settings page (relation "lore.settings" does not
-- exist). This migration closes that gap and seeds it for fresh environments.
--
-- Idempotent: safe to re-run.

CREATE SCHEMA IF NOT EXISTS lore;

CREATE TABLE IF NOT EXISTS lore.settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON lore.settings TO lore;
