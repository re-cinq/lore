import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.plan_versions` — every content change of a plan, with the document and projection as they were. */

export const PLAN_VERSION_TABLE = "lore.plan_versions";

export const PlanVersionSchema = z.object({
  planId: z.string(),
  number: z.number(),
  reason: z.string(),
  createdBy: z.string(),
  createdAt: z.date(),
  contentHash: z.string(),
  json: z.unknown(),
  state: z.instanceof(Uint8Array),
});

export type PlanVersionRow = z.infer<typeof PlanVersionSchema>;

export const PLAN_VERSION_COLUMNS = {
  planId: "plan_id",
  number: "version",
  reason: "reason",
  createdBy: "created_by",
  createdAt: "created_at",
  contentHash: "content_hash",
  json: "json",
  state: "state",
} as const satisfies ColumnMap<PlanVersionRow>;
