import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.plan_refine_asks` — the section a person asked the planning agent to refine, at most one per plan. A node started by hand carries no items, so the ask is read from here rather than from the run's bag. */

export const PLAN_REFINE_ASK_TABLE = "lore.plan_refine_asks";

export const PlanRefineAskSchema = z.object({
  planId: z.string(),
  slot: z.string(),
  title: z.string(),
  /** The section's hash when the ask was made, so a pass reports on what its person read. */
  baseHash: z.string(),
  inputs: z.unknown(),
  uses: z.unknown(),
  /** What the agent is told to do, as the brief words it. */
  brief: z.string(),
  askedAt: z.date(),
});

export type PlanRefineAsk = z.infer<typeof PlanRefineAskSchema>;

export const PLAN_REFINE_ASK_COLUMNS = {
  planId: "plan_id",
  slot: "slot",
  title: "title",
  baseHash: "base_hash",
  inputs: "inputs",
  uses: "uses",
  brief: "brief",
  askedAt: "asked_at",
} as const satisfies ColumnMap<PlanRefineAsk>;
