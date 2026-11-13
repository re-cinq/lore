-- 0127_plan_stories: the user story a plan was saved with. A planning run's
-- start items are fixed once it starts, so a story typed on the page had
-- nowhere to live between runs. One row per plan: no row means nobody ever
-- saved a story (the plan keeps the one its newest run carries), a row with a
-- NULL issue_number means a person removed the link on purpose.

CREATE TABLE IF NOT EXISTS lore.plan_stories (
  plan_id      uuid PRIMARY KEY REFERENCES lore.plans (id) ON DELETE CASCADE,
  issue_number integer,
  set_by       text        NOT NULL,
  set_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON lore.plan_stories TO lore;
