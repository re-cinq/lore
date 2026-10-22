import { z } from "zod";
import { CursorWalkSummarySchema } from "../walk-summary.js";

/** One walk of a base's memories and episodes (specs/utopia-graph-mirror FR16), an entry named by its external id: the episodes' cursor is `<created_at>|<id>`, the memories' the last id of a pass over them all. */
export const UtopiaMemorySummarySchema = z.object({
  memories: CursorWalkSummarySchema.extend({
    /** The walk reached the last memory: the next walk starts a new pass. */
    pass_complete: z.boolean(),
  }),
  episodes: CursorWalkSummarySchema,
});

export type UtopiaMemorySummary = z.infer<typeof UtopiaMemorySummarySchema>;
