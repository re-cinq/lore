// Handler for `assembly_line.resume`: a station reporting from outside the pod
// system (spec 6-dark-factory FR6.19).
//
// A `wait` node's worker is a human in the planning wizard, or a spec PR merging.
// When that worker acts, the outcome arrives here instead of on a
// `kubernetes.agent_node.*` event — and then takes exactly the path a pod's outcome
// takes: record the node, advance the walk. That convergence is the design. If this
// handler ever grows its own advance logic, the human node has stopped being a
// station and become a special case.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { NodeResult, StageOutcome } from "@re-cinq/lore-assembly-lines";
import { NodeResultSchema } from "@re-cinq/lore-assembly-lines";
import type { EventHandler } from "../../main-loop/types.js";

const OUTCOMES: ReadonlySet<string> = new Set<StageOutcome>([
  "success",
  "changes_requested",
  "failed",
]);

export interface ResumeEventHandlerDeps {
  assemblyRuns: Pick<AssemblyRunsPort, "mergeArgs">;
  /** Record the node's outcome and advance — the shared path (advance.ts). */
  finishNodeAndAdvance: (input: {
    assemblyLineId: string;
    nodeId: string;
    iteration?: number;
    result: NodeResult;
  }) => Promise<void>;
}

export function createResumeEventHandler(
  deps: ResumeEventHandlerDeps,
): EventHandler {
  return async (params) => {
    const assemblyLineId = params.assemblyRunId ?? params.assemblyLineId;
    const nodeId = params.nodeId;
    const outcome = String(params.outcome ?? "");

    enforceTrue(
      typeof assemblyLineId === "string" && assemblyLineId.length > 0,
      Error,
      "assembly_run.resume event params missing assemblyRunId",
    );
    // The line may be parked on any of several waits; guessing would resume the
    // wrong one, so the reporter must say which node it is completing.
    enforceTrue(
      typeof nodeId === "string" && nodeId.length > 0,
      Error,
      "assembly_line.resume event params missing nodeId",
    );
    // A typo'd outcome would route down an edge nobody wrote — or none at all,
    // since selectEdge does not fall through.
    enforceTrue(
      OUTCOMES.has(outcome),
      Error,
      `assembly_line.resume event has unknown outcome "${outcome}"`,
    );

    // What the worker produced rides into the line BEFORE the walk advances, so the
    // next node reads it as its brief — the same args channel a produced artifact
    // uses (FR6.17), not a second mechanism for human input.
    const args = params.args;

    if (args && typeof args === "object" && !Array.isArray(args)) {
      await deps.assemblyRuns.mergeArgs(
        assemblyLineId,
        args as Record<string, unknown>,
      );
    }

    await deps.finishNodeAndAdvance({
      assemblyLineId,
      nodeId,
      iteration:
        typeof params.iteration === "number" ? params.iteration : undefined,
      result: resumedResult(params, outcome as StageOutcome),
    });
  };
}

/**
 * What the resumed node actually produced.
 *
 * A HUMAN station reports a decision and nothing else, so the bare outcome is
 * the whole result and the fallback is not a degradation. A station reporting
 * from a process produces more, and the walk routes on it: a triage node's
 * entire output is `extras.action`, and `failureClass` decides whether a failure
 * spends a retry budget or parks agent dispatch account-wide. Sending only the
 * outcome — which this did — silently discarded both.
 *
 * Parsed rather than cast: the result arrives as JSON from another process, and
 * a malformed one must fail the event (which retries) instead of advancing the
 * walk on a result nothing can route.
 */
function resumedResult(
  params: Record<string, unknown>,
  outcome: StageOutcome,
): NodeResult {
  if (params.result === undefined || params.result === null) {
    return { outcome };
  }

  const result = NodeResultSchema.parse(params.result);

  // Both fields carry the outcome, and only `params.outcome` passed the OUTCOMES
  // guard above — so a result spelling a different one would walk an edge that
  // was never checked. They come from the same sender, so disagreeing is a bug
  // in it, and the event failing is how that becomes visible.
  enforceTrue(
    result.outcome === outcome,
    Error,
    `assembly_line.resume disagrees with itself: outcome "${outcome}" but result.outcome "${result.outcome}"`,
  );

  return result;
}

/** Composed production handler for the registry. Deps are resolved lazily so
 *  importing the registry never forces the DB pool or the K8s client. */
export const assemblyLineResume: EventHandler = async (params) => {
  const [{ pipeline }, { finishNodeAndAdvance }, { productionNodeEventDeps }] =
    await Promise.all([
      import("../../kernel/queues.js"),
      import("./advance.js"),
      import("./node-event-handler.js"),
    ]);

  const handler = createResumeEventHandler({
    assemblyRuns: pipeline().assemblyRuns,
    // The SAME deps the node-event handler advances with: a station reporting from a
    // browser and one reporting from a pod must walk the graph identically.
    finishNodeAndAdvance: async (input) =>
      finishNodeAndAdvance(input, await productionNodeEventDeps()),
  });

  await handler(params);
};
