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
