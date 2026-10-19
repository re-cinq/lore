import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.plans` — one plan's workflow meta, written by lore-api's PgPlanStore for @re-cinq/planning-sync; the content lives in `lore.plan_state`. */

export const PLAN_TABLE = "lore.plans";

export const PlanSchema = z.object({
  id: z.string(),
  repo: z.string(),
  title: z.string(),
  type: z.string(),
  templateVersion: z.number(),
  status: z.string(),
  approval: z.unknown().nullable(),
  currentVersion: z.number(),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Plan = z.infer<typeof PlanSchema>;

export const PLAN_COLUMNS = {
  id: "id",
  repo: "repo",
  title: "title",
  type: "type",
  templateVersion: "template_version",
  status: "status",
  approval: "approval",
  currentVersion: "current_version",
  createdBy: "created_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<Plan>;
