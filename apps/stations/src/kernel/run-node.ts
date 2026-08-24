/**
 * Run an assembly-line node that was published for this service to claim.
 *
 * The Floor decides WHEN a node runs and publishes it; this runs it and reports
 * the outcome back over `assembly_run.resume` — the same channel a person
 * reports through from the wizard, so the walk converges whether the worker was
 * a pod, a person, or this process.
 *
 * A station that throws is reported as a FAILED node, not left to the bus's
 * retry: the visit row is the unit of work and the walk's own edges decide
 * whether a failure is retried, so retrying here as well would run the node
 * up to five more times behind the walk's back.
 */

import {
  nodeStationFor,
  type NodeStationRun,
  type StationEnv,
} from "@re-cinq/lore-station-registry";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

export interface PublishedNode {
  stationRunId: string;
  assemblyLineId: string;
  nodeId: string;
  iteration: number;
  nodeType: string;
  repo: string;
  branch: string;
  taskId: string | null;
  params: Record<string, string>;
}

/** Reports a node's outcome to the parked visit — `reportToParkedNode`'s shape. */
export type ReportNode = (
  target: { lineId: string; nodeId: string; iteration: number },
  outcome: "success" | "changes_requested" | "failed",
  args: Record<string, unknown>,
  result?: unknown,
) => Promise<void>;

/** Only a pod has a cloned workspace; a station needing one never runs here. */
const NO_WORKSPACE: StationEnv = { workspaceDir: "" };

const failed = (detail: string): NodeResult => ({
  outcome: "failed",
  failureClass: "unknown",
  failureDetail: detail,
});

export async function runPublishedNode(
  event: PublishedNode,
  report: ReportNode,
  // The RUNNER, not the module: this needs nothing else from the manifest, and a
  // narrower seam is one a test can satisfy with the function under test.
  run: NodeStationRun | undefined = nodeStationFor(event.nodeType)?.run,
): Promise<void> {
  const input: StationInput = {
    assembly_run_id: event.assemblyLineId,
    node_id: event.nodeId,
    node_type: event.nodeType,
    repo: event.repo,
    branch: event.branch,
    task_id: event.taskId,
    params: event.params,
  };

  const result = run
    ? await run(input, NO_WORKSPACE).catch((err: Error) => failed(err.message))
    : failed(
        `no station answers to node type "${event.nodeType}" — the registry and the blueprint disagree`,
      );

  await report(
    {
      lineId: event.assemblyLineId,
      nodeId: event.nodeId,
      iteration: event.iteration,
    },
    result.outcome,
    {},
    result,
  );
}
