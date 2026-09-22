import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.plan_state` — a plan's live Yjs document and the JSON projected from it at the same write. */

export const PLAN_STATE_TABLE = "lore.plan_state";

export const PlanStateSchema = z.object({
  planId: z.string(),
  state: z.instanceof(Uint8Array),
  json: z.unknown(),
  contentHash: z.string(),
  updatedAt: z.date(),
});

export type PlanState = z.infer<typeof PlanStateSchema>;

export const PLAN_STATE_COLUMNS = {
  planId: "plan_id",
  state: "state",
  json: "json",
  contentHash: "content_hash",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<PlanState>;
