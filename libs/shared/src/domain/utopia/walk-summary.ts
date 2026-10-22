import { z } from "zod";

/** What one cursor walk answers: the cursor it started from, the cursor after the last entry that landed, and Utopia's counts. */
export const CursorWalkSummarySchema = z.object({
  /** The cursor the walk started from, null for a first walk. */
  from: z.string().nullable(),
  /** The cursor after the last entry pushed; null when none landed. */
  to: z.string().nullable(),
  entries: z.number(),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  /** `<entry>: <message>` for the entry the walk stopped at; the next walk retries it. */
  failed: z.array(z.string()),
});
