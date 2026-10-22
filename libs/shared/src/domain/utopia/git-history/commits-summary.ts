import { z } from "zod";

/** What one walk of a repo's default-branch commits answers (specs/utopia-graph-mirror FR12): the cursor it started above, the newest commit it pushed, and Utopia's counts. */
export const UtopiaCommitsSummarySchema = z.object({
  branch: z.string(),
  /** The commit the walk started above, null for a first walk from the root. */
  from: z.string().nullable(),
  /** The newest commit pushed, now the cursor; null when none landed. */
  to: z.string().nullable(),
  commits: z.number(),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  /** `<sha>: <message>` for the commit the walk stopped at; the next walk retries it. */
  failed: z.array(z.string()),
  /** Why no commit was read: the branch is not the default one. */
  skipped: z.string().optional(),
});

export type UtopiaCommitsSummary = z.infer<typeof UtopiaCommitsSummarySchema>;
