import { z } from "zod";
import { CursorWalkSummarySchema } from "../walk-summary.js";

/** One walk of a repo's issues and pull requests (specs/utopia-graph-mirror FR14): its cursor is an update time, and an entry is named `<pull|issue>:<number>`. */
export const UtopiaTrackerSummarySchema = CursorWalkSummarySchema;

export type UtopiaTrackerSummary = z.infer<typeof UtopiaTrackerSummarySchema>;
