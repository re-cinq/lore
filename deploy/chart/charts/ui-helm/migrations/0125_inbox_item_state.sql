CREATE TABLE IF NOT EXISTS lore.inbox_item_state (
  person        TEXT        NOT NULL,
  item_id       TEXT        NOT NULL,
  handled_at    TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person, item_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON lore.inbox_item_state TO lore;
