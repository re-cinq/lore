-- 0133_release_schedule_attempts: when a repo's schedule last started a release run, one row per
-- repo. A day with nothing merged ends the run empty and stores no release, so this mark is what
-- keeps the tick from starting another run every 15 minutes of that day.

CREATE TABLE IF NOT EXISTS lore.release_schedule_attempts (
  repo         TEXT        PRIMARY KEY,
  attempted_at TIMESTAMPTZ NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON lore.release_schedule_attempts TO lore;
