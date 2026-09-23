/** A planning line parked on its author means the plan is open for writing (specs/7-feature-planning FR-18): whatever sent the line back there — the spec analysis's question, a person running the station by hand — lore-api reopens an approved plan so its people can answer. */

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { PlanOpener } from "../../domain/plan-writer.js";

// Matched by TYPE, not node id, so renaming the node in feature-planning.yaml cannot silently stop the reopen (same rule as round-dispatch).
const AUTHOR_STATION_TYPE = "feature_review";

export function openPlanForAuthor(plans: PlanOpener) {
  return async (row: AssemblyRunRecord, node: RunGraphNode): Promise<void> => {
    const planId = row.args.plan_id;

    if (node.type !== AUTHOR_STATION_TYPE || typeof planId !== "string") {
      return;
    }
    await plans.openForAuthor(row.repo, planId);
  };
}
