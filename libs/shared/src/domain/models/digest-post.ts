import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.digest_posts` — one row per repo per daily-digest run (specs/daily-digest FR7): claimed with an empty `threadTs` before Slack is called, finished with the thread and the intro/ending the post carried. */

export const DigestPostSchema = z.object({
  runId: z.string(),
  repo: z.string(),
  channelId: z.string(),
  weekKey: z.string(),
  /** Empty while the post is only claimed. */
  threadTs: z.string(),
  intro: z.string(),
  ending: z.string(),
  postedAt: z.date(),
});

export type DigestPost = z.infer<typeof DigestPostSchema>;

export const DIGEST_POST_COLUMNS = {
  runId: "run_id",
  repo: "repo",
  channelId: "channel_id",
  weekKey: "week_key",
  threadTs: "thread_ts",
  intro: "intro",
  ending: "ending",
  postedAt: "posted_at",
} as const satisfies ColumnMap<DigestPost>;

export const DIGEST_POST_TABLE = "lore.digest_posts";
