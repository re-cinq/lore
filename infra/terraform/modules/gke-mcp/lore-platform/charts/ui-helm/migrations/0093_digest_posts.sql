-- 0093_digest_posts: one row per repo per daily-digest run — the "already posted today" watermark, the
-- channel's weekly Slack thread, and the intro/ending texts the next drafts must not repeat
-- (specs/daily-digest FR7). A row is CLAIMED (thread_ts = '') before Slack is called and FINISHED after,
-- so an upload and a terminal event racing for the same run post once.

CREATE TABLE IF NOT EXISTS lore.digest_posts (
  run_id     UUID        NOT NULL,
  repo       TEXT        NOT NULL,
  channel_id TEXT        NOT NULL,
  week_key   TEXT        NOT NULL,
  thread_ts  TEXT        NOT NULL DEFAULT '',
  intro      TEXT        NOT NULL DEFAULT '',
  ending     TEXT        NOT NULL DEFAULT '',
  posted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, repo)
);

CREATE INDEX IF NOT EXISTS digest_posts_repo_posted
  ON lore.digest_posts (repo, posted_at DESC);
CREATE INDEX IF NOT EXISTS digest_posts_channel_week
  ON lore.digest_posts (channel_id, week_key, posted_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON lore.digest_posts TO lore;
