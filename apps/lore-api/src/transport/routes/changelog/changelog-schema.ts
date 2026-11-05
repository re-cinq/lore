import { z } from "zod";
import { ChangelogChangeSchema } from "@re-cinq/lore-shared/models/changelog-week.js";

/** An ISO week of any year: the year in digits, the week 01 to 53. */
export const WeekKey = z.string().regex(/^\d+-W(0[1-9]|[1-4]\d|5[0-3])$/);

export const ChangelogQuerySchema = z.object({
  before: WeekKey.optional(),
  limit: z.coerce.number().int().min(1).max(12).default(8), // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
});

export const ChangelogPageSchema = z.object({
  weeks: z.array(
    z.object({
      weekKey: WeekKey,
      from: z.string(),
      to: z.string(),
      current: z.boolean(),
      intro: z.string().nullable(),
      changes: z.array(ChangelogChangeSchema),
    }),
  ),
  next: WeekKey.nullable(),
});
