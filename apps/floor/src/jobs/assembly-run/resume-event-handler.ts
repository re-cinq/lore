// Handler for `assembly_line.resume`: a station reporting from outside the pod system (spec 6-dark-factory FR6.19); converges on the same record-then-advance path as a pod outcome.

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

function assemblyLineIdFrom(params: Record<string, unknown>): string {
  const assemblyLineId = params.assemblyRunId ?? params.assemblyLineId;

  enforceTrue(
    typeof assemblyLineId === "string" && assemblyLineId.length > 0,
    Error,
    "assembly_run.resume event params missing assemblyRunId",
  );

  return assemblyLineId as string;
}

// The line may be parked on several waits; the reporter must say which node it is completing.
function nodeIdFrom(params: Record<string, unknown>): string {
  const nodeId = params.nodeId;

  enforceTrue(
    typeof nodeId === "string" && nodeId.length > 0,
    Error,
    "assembly_line.resume event params missing nodeId",
  );

  return nodeId as string;
}

// A typo'd outcome would route down an edge nobody wrote, since selectEdge does not fall through.
function outcomeFrom(params: Record<string, unknown>): StageOutcome {
  const outcome = String(params.outcome ?? "");

  enforceTrue(
    OUTCOMES.has(outcome),
    Error,
    `assembly_line.resume event has unknown outcome "${outcome}"`,
  );

  return outcome as StageOutcome;
}

// Rides in BEFORE the walk advances, via the same args channel a produced artifact uses (FR6.17).
async function mergeArgsIfObject(
  deps: ResumeEventHandlerDeps,
  assemblyLineId: string,
  args: unknown,
): Promise<void> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    await deps.assemblyRuns.mergeArgs(
      assemblyLineId,
      args as Record<string, unknown>,
    );
  }
}

function iterationFrom(params: Record<string, unknown>): number | undefined {
  return typeof params.iteration === "number" ? params.iteration : undefined;
}

export function createResumeEventHandler(
  deps: ResumeEventHandlerDeps,
): EventHandler {
  return async (params) => {
    const assemblyLineId = assemblyLineIdFrom(params);
    const nodeId = nodeIdFrom(params);
    const outcome = outcomeFrom(params);

    await mergeArgsIfObject(deps, assemblyLineId, params.args);

    await deps.finishNodeAndAdvance({
      assemblyLineId,
      nodeId,
      iteration: iterationFrom(params),
      result: resumedResult(params, outcome),
    });
  };
}

/** What the resumed node produced — parsed (not cast) since a malformed result must fail the event rather than advance the walk unroutably. */
function resumedResult(
  params: Record<string, unknown>,
  outcome: StageOutcome,
): NodeResult {
  if (params.result === undefined || params.result === null) {
    return { outcome };
  }

  const result = NodeResultSchema.parse(params.result);

  // Only `params.outcome` passed the OUTCOMES guard above; disagreement is a bug in the sender, surfaced by failing the event.
  enforceTrue(
    result.outcome === outcome,
    Error,
    `assembly_line.resume disagrees with itself: outcome "${outcome}" but result.outcome "${result.outcome}"`,
  );

  return result;
}

/** Composed production handler; deps resolved lazily so importing the registry never forces the DB pool or K8s client. */
export const assemblyLineResume: EventHandler = async (params) => {
  const [{ pipeline }, { finishNodeAndAdvance }, { productionNodeEventDeps }] =
    await Promise.all([
      import("../../kernel/queues.js"),
      import("./advance.js"),
      import("./node-event-handler.js"),
    ]);

  const handler = createResumeEventHandler({
    assemblyRuns: pipeline().assemblyRuns,
    // Same deps the node-event handler advances with — browser and pod reporters must walk the graph identically.
    finishNodeAndAdvance: async (input) =>
      finishNodeAndAdvance(input, await productionNodeEventDeps()),
  });

  await handler(params);
};
