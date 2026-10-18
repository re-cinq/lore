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

/** What one cursor walk answers: the cursor it started from, the cursor after the last entry that landed, and Utopia's counts. */
const CursorWalkSummarySchema = z.object({
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

/** One walk of a repo's issues and pull requests (specs/utopia-graph-mirror FR14): its cursor is an update time, and an entry is named `<pull|issue>:<number>`. */
export const UtopiaTrackerSummarySchema = CursorWalkSummarySchema;

export type UtopiaTrackerSummary = z.infer<typeof UtopiaTrackerSummarySchema>;

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

/** One walk of a base's memories and episodes (specs/utopia-graph-mirror FR16): each cursor is the row's mirror sequence number, and an entry is named by its external id. */
export const UtopiaMemorySummarySchema = z.object({
  memories: CursorWalkSummarySchema,
  episodes: CursorWalkSummarySchema,
});

export type UtopiaMemorySummary = z.infer<typeof UtopiaMemorySummarySchema>;

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
