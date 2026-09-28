import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.digest_posts` — one row per repo per daily-digest run (specs/daily-digest FR7): claimed before Slack is called, then posted with the thread and the intro/ending the post carried, or failed keeping the thread it opened. */

export const DigestPostStatusSchema = z.enum(["claimed", "posted", "failed"]);

export const DigestPostSchema = z.object({
  runId: z.string(),
  repo: z.string(),
  channelId: z.string(),
  weekKey: z.string(),
  /** claimed before Slack is called; posted once any part of it is in the channel; failed when Slack refused before that. */
  status: DigestPostStatusSchema,
  /** The week's thread; empty while claimed, and on a failed run that never opened one. */
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
  status: "status",
  threadTs: "thread_ts",
  intro: "intro",
  ending: "ending",
  postedAt: "posted_at",
} as const satisfies ColumnMap<DigestPost>;

export const DIGEST_POST_TABLE = "lore.digest_posts";
