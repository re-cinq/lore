import type {
  DigestSettings,
  ResolvedDigestSettings,
} from "../digest-settings.js";
import { z } from "zod";
import type { Assert, Equals } from "./schema-equals.js";

/** The `digest` block of `lore.repos.settings` (specs/daily-digest FR1); JSONB storage, so keys stay snake_case. Resolver + defaults stay in `../digest-settings.js` — only the shape lives here. */

export const DigestSectionSchema = z.enum([
  "implemented",
  "roadmap",
  "summary",
  "morale",
]);
export const DigestGroupBySchema = z.enum(["person", "area"]);

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Weekday = z.number().int().min(0).max(6);

export const DigestSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  time: TimeOfDay.optional(),
  days: z.array(Weekday).optional(),
  timezone: z.string().optional(),
  sections: z.array(DigestSectionSchema).optional(),
  group_by: DigestGroupBySchema.optional(),
});

/** The same block after `resolveDigestSettings` has filled every default. */
export const ResolvedDigestSettingsSchema = z.object({
  enabled: z.boolean(),
  time: TimeOfDay,
  days: z.array(Weekday),
  timezone: z.string(),
  sections: z.array(DigestSectionSchema),
  group_by: DigestGroupBySchema,
});

export type {
  DigestGroupBy,
  DigestSection,
  DigestSettings,
  ResolvedDigestSettings,
} from "../digest-settings.js";

/** Proves the schemas above and the plain types in `../digest-settings.ts` are one shape; a field added to either side alone fails `tsc`. */
type SchemaMatchesTypes = Assert<
  Equals<z.infer<typeof DigestSettingsSchema>, DigestSettings>
> &
  Assert<
    Equals<z.infer<typeof ResolvedDigestSettingsSchema>, ResolvedDigestSettings>
  >;

export type { SchemaMatchesTypes };
