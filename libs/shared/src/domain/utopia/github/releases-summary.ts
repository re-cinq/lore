import { z } from "zod";

/** What one push of a repo's tags and published releases answers (specs/utopia-graph-mirror FR15): how many of each were read, and Utopia's counts. */
export const UtopiaReleasesSummarySchema = z.object({
  tags: z.number(),
  releases: z.number(),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  /** `<tag|release>:<name>: <message>` for every item that did not land; the others still did, and the next push sends them all again. */
  failed: z.array(z.string()),
});

export type UtopiaReleasesSummary = z.infer<typeof UtopiaReleasesSummarySchema>;
