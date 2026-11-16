import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.plan_stories` — the user story a plan was saved with, at most one row per plan. No row means never saved; a null `issueNumber` means the link was removed on purpose. */

export const PLAN_STORY_TABLE = "lore.plan_stories";

export const PlanStorySchema = z.object({
  planId: z.string(),
  issueNumber: z.number().int().nullable(),
  setBy: z.string(),
  setAt: z.date(),
});

export type PlanStory = z.infer<typeof PlanStorySchema>;

export const PLAN_STORY_COLUMNS = {
  planId: "plan_id",
  issueNumber: "issue_number",
  setBy: "set_by",
  setAt: "set_at",
} as const satisfies ColumnMap<PlanStory>;
