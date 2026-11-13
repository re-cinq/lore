-- 0129_service_versions: the build each Lore service runs. Every service
-- writes its own row when it starts (lore-api, stations, and the lore-mcp
-- gateway through lore-api), and GET /api/versions answers from it.

CREATE TABLE IF NOT EXISTS lore.service_versions (
  service    text PRIMARY KEY,
  build      text        NOT NULL,
  packages   jsonb       NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON lore.service_versions TO lore;
