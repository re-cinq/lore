// What a feature-planning line's `analyze` node settling means for the plan it wrote: presence always closes, and a Refine's answer (success or failure) is recorded on the section it was asked for.

import type { PlanWriter, RefineContext } from "../../domain/plan-writer.js";

/** The section a Refine's pass answered, with `uses` always present (unlike the optional field a run's args carry it as). */
type RefineAnswer = { slot: string; uses: unknown };

/** The plan a settled `analyze` node touches, and the Refine (if any) its pass answered. Null for any other node, or a run naming no plan. */
export interface PlanningPassEnd {
  planId: string;
  refine: RefineAnswer | null;
  failed: boolean;
}

export function planningPassEnd(
  args: Readonly<Record<string, unknown>>,
  nodeId: string,
  outcome: string,
): PlanningPassEnd | null {
  const planId = args.plan_id;

  if (nodeId !== "analyze" || typeof planId !== "string") {
    return null;
  }

  return { planId, refine: refineOf(args.refine), failed: outcome !== "success" };
}

function refineOf(value: unknown): RefineAnswer | null {
  const refine = (value ?? {}) as Partial<RefineContext>;

  return typeof refine.slot === "string"
    ? { slot: refine.slot, uses: refine.uses ?? null }
    : null;
}

/** Closes presence, then settles a Refine's answer on the section it was asked for — success proposes it, failure tells the section why. A draft (no refine) closes presence only. */
export async function settlePlanningPass(
  args: Readonly<Record<string, unknown>>,
  nodeId: string,
  outcome: string,
  plans: Pick<PlanWriter, "closePresence" | "finishRefine" | "failRefine">,
): Promise<void> {
  const end = planningPassEnd(args, nodeId, outcome);

  if (!end) {
    return;
  }
  await plans.closePresence(end.planId);

  if (!end.refine) {
    return;
  }

  await (end.failed
    ? plans.failRefine(end.planId, {
        slot: end.refine.slot,
        reason: "the planning agent's pass did not succeed",
      })
    : plans.finishRefine(end.planId, end.refine));
}
