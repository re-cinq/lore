import { z } from "zod";
import { UtopiaCommitsSummarySchema } from "./git-history/commits-summary.js";
import { UtopiaReleasesSummarySchema } from "./github/releases-summary.js";
import { UtopiaTrackerSummarySchema } from "./github/tracker-summary.js";
import { UtopiaMemorySummarySchema } from "./memory/memory-summary.js";

/** What one repo's Utopia backfill answers (specs/utopia-graph-mirror FR7.4): lore-api's route sends it, the nightly sweep reads it. */
export const UtopiaBackfillSummarySchema = z.object({
  commit: z.string(),
  documents: z.number(),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  /** `<path>: <message>` for every document that did not land whole; the others still did. */
  failed: z.array(z.string()),
  /** The default branch's commits above the stored cursor, pushed after the documents; absent from a lore-api older than the commit mirror. */
  commits: UtopiaCommitsSummarySchema.optional(),
  /** The issues and pull requests updated since the stored cursor, pushed after the commits; absent from a lore-api older than the tracker mirror. */
  tracker: UtopiaTrackerSummarySchema.optional(),
  /** The repo's tags and published releases, pushed after the tracker walk; absent from a lore-api older than the release mirror. */
  releases: UtopiaReleasesSummarySchema.optional(),
  /** The repo's memories and episodes above their cursors, pushed after the releases; absent from a lore-api older than the memory mirror. */
  memory: UtopiaMemorySummarySchema.optional(),
});

export type UtopiaBackfillSummary = z.infer<typeof UtopiaBackfillSummarySchema>;
