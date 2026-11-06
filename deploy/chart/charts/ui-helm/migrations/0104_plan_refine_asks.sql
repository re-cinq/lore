-- 0104_plan_refine_asks: the section a person asked the planning agent to
-- refine. Pressing Refine now starts the `analyze` node by hand rather than
-- handing the ask to a run that happens to be waiting, and a node started by
-- hand carries no items (the floor's start payload is the run and who asked),
-- so the ask is written here for the agent and `plan-pass-end` to read.
-- One pending ask per plan: a second Refine replaces it.

CREATE TABLE IF NOT EXISTS lore.plan_refine_asks (
  plan_id   uuid PRIMARY KEY REFERENCES lore.plans (id) ON DELETE CASCADE,
  slot      text        NOT NULL,
  title     text        NOT NULL,
  base_hash text        NOT NULL,
  inputs    jsonb,
  uses      jsonb,
  brief     text        NOT NULL,
  asked_at  timestamptz NOT NULL DEFAULT now()
);
