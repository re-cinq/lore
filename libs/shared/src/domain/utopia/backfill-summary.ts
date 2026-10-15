import { z } from "zod";

/** What one repo's Utopia backfill answers (specs/utopia-graph-mirror FR7.4): lore-api's route sends it, the nightly sweep reads it. */
export const UtopiaBackfillSummarySchema = z.object({
  commit: z.string(),
  documents: z.number(),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  /** `<path>: <message>` for every document that did not land whole; the others still did. */
  failed: z.array(z.string()),
});

export type UtopiaBackfillSummary = z.infer<typeof UtopiaBackfillSummarySchema>;
