// What a feature-planning line's `analyze` node means for the plan it writes: presence opens before its pod launches, and when it settles presence closes and a Refine's answer (success or failure) is recorded on the section it was asked for.

import type {
  FailedRefine,
  PlanRunRef,
  PlanningPassWriter,
  RefineContext,
} from "../../domain/plan-writer.js";
import { planRunRefOf, unansweredRefine } from "../agent/planning-result.js";

/** The feature-planning line's node whose pod is the planning agent. */
const PLANNING_NODE = "analyze";

/** The plan a node's pass writes and the Refine it answers — only the planning agent's node of a run naming a plan; null for any other node. */
export function planningPassOf(
  args: Readonly<Record<string, unknown>> | undefined,
  nodeId: string,
): PlanRunRef | null {
  return nodeId === PLANNING_NODE ? (planRunRefOf(args ?? {}) ?? null) : null;
}

/** How a settled pass answers its Refine: success proposes the section, anything else tells it what the agent stopped with. */
export type RefineSettlement =
  { finish: { slot: string; uses: unknown } } | { fail: FailedRefine };

/** The plan a settled planning node touches, and how its Refine (if any) is answered. */
export interface PlanningPassEnd {
  planId: string;
  refine: RefineSettlement | null;
}

/** Null for any other node, or a run naming no plan. */
export function planningPassEnd(
  args: Readonly<Record<string, unknown>>,
  nodeId: string,
  outcome: string,
): PlanningPassEnd | null {
  const pass = planningPassOf(args, nodeId);

  return (
    pass && {
      planId: pass.planId,
      refine: pass.refine && refineSettlement(pass.refine, outcome),
    }
  );
}

function refineSettlement(
  refine: RefineContext,
  outcome: string,
): RefineSettlement {
  return outcome === "success"
    ? { finish: { slot: refine.slot, uses: refine.uses ?? null } }
    : { fail: unansweredRefine(refine, `outcome ${outcome}`) };
}

/** Closes presence, then applies the Refine's settlement on the section it was asked for. A draft (no refine) closes presence only. */
export async function settlePlanningPass(
  args: Readonly<Record<string, unknown>>,
  nodeId: string,
  outcome: string,
  plans: PlanningPassWriter,
): Promise<void> {
  const end = planningPassEnd(args, nodeId, outcome);

  if (!end) {
    return;
  }
  await plans.closePresence(end.planId);

  if (!end.refine) {
    return;
  }
  await ("fail" in end.refine
    ? plans.failRefine(end.planId, end.refine.fail)
    : plans.finishRefine(end.planId, end.refine.finish));
}
