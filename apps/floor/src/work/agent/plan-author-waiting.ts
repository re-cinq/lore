/** A planning line parked on a human station may mean the plan is open for writing (specs/7-feature-planning FR-18): parked on its author — whatever sent it there, the spec analysis's question or a person running the station by hand — lore-api reopens an approved plan so its people can answer; parked on the spec PR's wait after the spec writer sent the review's questions to the plan, lore-api reopens it for those, and the run's flag is cleared so the next park asks nothing. */

import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { SPEC_REVIEW_REOPEN_ARG } from "@re-cinq/lore-shared/review/spec-review.js";
import type { PlanOpener } from "../../domain/plan-writer.js";
import { SPEC_WRITER_ACTOR } from "./spec-review-result.js";

// Matched by TYPE, not node id, so renaming a node in feature-planning.yaml cannot silently stop the reopen (same rule as round-dispatch).
const AUTHOR_STATION_TYPE = "feature_review";
const PR_WAIT_STATION_TYPE = "pr_review";

export type ParkReaction = "open-author" | "reopen-for-review" | "none";

/** What a park on `node` asks of the plan the run's args name; nothing for a run that drafts no plan. */
export function decideParkReaction(
  node: RunGraphNode,
  args: Readonly<Record<string, unknown>>,
): ParkReaction {
  if (typeof args.plan_id !== "string") {
    return "none";
  }

  if (node.type === AUTHOR_STATION_TYPE) {
    return "open-author";
  }

  return node.type === PR_WAIT_STATION_TYPE &&
    args[SPEC_REVIEW_REOPEN_ARG] === true
    ? "reopen-for-review"
    : "none";
}

export interface ParkReactionDeps {
  plans: PlanOpener;
  assemblyRuns: Pick<AssemblyRunsPort, "mergeArgs">;
}

/** The `onHumanNodeParked` reaction: best-effort, the caller logs a throw and the node stays parked. */
export function reopenPlanOnPark(deps: ParkReactionDeps) {
  return async (row: AssemblyRunRecord, node: RunGraphNode): Promise<void> => {
    const reaction = decideParkReaction(node, row.args);

    if (reaction === "none") {
      return;
    }
    const planId = row.args.plan_id as string;

    if (reaction === "open-author") {
      await deps.plans.openForAuthor(row.repo, planId);

      return;
    }
    await deps.plans.reopenForReview(row.repo, planId, SPEC_WRITER_ACTOR);
    await deps.assemblyRuns.mergeArgs(row.id, {
      [SPEC_REVIEW_REOPEN_ARG]: null,
    });
  };
}
