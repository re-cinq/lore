import { z } from "zod";
import { PipelineNodeSchema } from "../../../work/assembly-line-station/mini-pipeline.js";

/** What every loop's row carries besides its own reference: its state, the open run on it with that run's stages, and when it was opened. */
export const loopRowFields = {
  title: z.string(),
  state: z.string(),
  run_id: z.string().nullable(),
  pipeline: z.array(PipelineNodeSchema).nullable(),
  created_at: z.string().nullable(),
};

/** The sections every loop's read answers (specs/implementation-loop FR9), so the Loops tab joins them by name: work a run is on now, work waiting, work parked on a person, work awaiting its merge, and work recently done. */
export function loopSectionsSchema<Row extends z.ZodTypeAny>(row: Row) {
  return z.object({
    current: z.array(row),
    backlog: z.array(row),
    parked: z.array(row),
    awaiting_merge: z.array(row),
    recent: z.array(row),
  });
}

/** The sections the Loops tab shows a few rows of at a time; Current always shows every row. */
export const LIMITED_SECTIONS = [
  "backlog",
  "parked",
  "awaiting_merge",
  "recent",
] as const;

type LimitedSection = (typeof LIMITED_SECTIONS)[number];

/** The most rows one section may be asked for. */
const MAX_SECTION_LIMIT = 200;

// eslint-disable-next-line re-lint/max-member-chain -- a schema built by chaining, not a reach into collaborators
const sectionLimit = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_SECTION_LIMIT)
  .optional();

/** How many rows of each section the page shows, `?recent=5&backlog=10`; a section with none named is answered whole. */
export const SectionLimitsQuery = z.object({
  backlog: sectionLimit,
  parked: sectionLimit,
  awaiting_merge: sectionLimit,
  recent: sectionLimit,
});

export type SectionLimits = z.infer<typeof SectionLimitsQuery>;

/** Each limited section cut to one row more than its limit, so the page can tell that there is more without being sent all of it. Current is never cut. */
export function capSections<
  Sections extends Record<LimitedSection, readonly unknown[]>,
>(sections: Sections, limits: SectionLimits): Sections {
  const capped = { ...sections };

  for (const key of LIMITED_SECTIONS) {
    const limit = limits[key];

    if (limit !== undefined) {
      capped[key] = sections[key].slice(0, limit + 1) as Sections[typeof key];
    }
  }

  return capped;
}
