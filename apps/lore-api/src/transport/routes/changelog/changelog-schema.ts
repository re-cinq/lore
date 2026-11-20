import { z } from "zod";
import { ChangelogChangeSchema } from "@re-cinq/lore-shared/models/changelog-week.js";

/** An ISO week of any year: the year in digits, the week 01 to 53. */
export const WeekKey = z.string().regex(/^\d+-W(0[1-9]|[1-4]\d|5[0-3])$/);

/** The `before` of a release page: the end of the last release the page before listed. */
export const ReleaseCursor = z
  .string()
  .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);

export const ChangelogQuerySchema = z.object({
  before: z.union([WeekKey, ReleaseCursor]).optional(),
  limit: z.coerce.number().int().min(1).max(12).default(8), // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
});

const ChangesSchema = z.array(ChangelogChangeSchema);

const ReleaseSchema = z.object({
  version: z.string(),
  previousTag: z.string().nullable(),
  bump: z.enum(["major", "minor", "patch"]),
  from: z.string().nullable(),
  to: z.string(),
  summary: z.string(),
  changes: ChangesSchema,
  releaseUrl: z.string().nullable(),
  publishedTo: z.string().nullable(),
});

const UnreleasedSchema = z.object({
  latestVersion: z.string().nullable(),
  since: z.string().nullable(),
  changes: ChangesSchema,
});

/** Weeks stay as they were; a repository with releases answers `mode: "releases"` with `weeks` empty and its releases beside, and a week-mode answer carries none of the new keys. */
export const ChangelogPageSchema = z.object({
  mode: z.literal("releases").optional(),
  releases: z.array(ReleaseSchema).optional(),
  unreleased: UnreleasedSchema.nullable().optional(),
  weeks: z.array(
    z.object({
      weekKey: WeekKey,
      from: z.string(),
      to: z.string(),
      current: z.boolean(),
      intro: z.string().nullable(),
      changes: ChangesSchema,
    }),
  ),
  next: z.union([WeekKey, ReleaseCursor]).nullable(),
});
