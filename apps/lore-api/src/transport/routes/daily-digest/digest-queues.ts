// The daily digest in the shared loop sections, from what `lore.digest_posts` recorded for the repository. Pure, what the route read is handed in.
import { z } from "zod";
import { loopRowFields, loopSectionsSchema } from "../loops/loop-sections.js";

export const DigestRowSchema = z.object({
  /** The day the digest was posted, `2026-10-23`. */
  ref: z.string(),
  /** `state`: `claimed` while it is being posted, `posted`, or `failed`. */
  ...loopRowFields,
});

/** The daily digest in the shared loop sections: Current, a post going out now; Parked, the newest post when it failed; Recently addressed, the posts that went out this week. Backlog and Awaiting merge stay empty. */
export const DailyDigestSchema = loopSectionsSchema(DigestRowSchema);

export type DigestRow = z.infer<typeof DigestRowSchema>;
export type DailyDigest = z.infer<typeof DailyDigestSchema>;

export interface DigestPost {
  /** The run that made the post, when it could be found. */
  runId: string | null;
  status: string;
  postedAt: string;
}

const DAY_LENGTH = "2026-10-23".length;

/** From the repository's posts, newest first. */
export function digestQueues(posts: readonly DigestPost[]): DailyDigest {
  const settled = posts.filter((post) => post.status !== "claimed");
  const newest = settled.at(0);

  return {
    current: posts.filter((post) => post.status === "claimed").map(row),
    backlog: [],
    parked: newest?.status === "failed" ? [row(newest)] : [],
    awaiting_merge: [],
    recent: posts.filter((post) => post.status === "posted").map(row),
  };
}

function row(post: DigestPost): DigestRow {
  return {
    ref: post.postedAt.slice(0, DAY_LENGTH),
    title: "Daily digest",
    state: post.status,
    run_id: post.runId,
    pipeline: null,
    created_at: post.postedAt,
  };
}
