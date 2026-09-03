// Runs an assembly-line node published for this service to claim; reports the outcome back over `assembly_run.resume` (same channel a person uses) so the walk converges regardless of worker. A throw is reported as a FAILED node rather than retried by the bus — the walk's own edges own retry, so retrying here too would run the node up to 5x behind its back.

import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  nodeStationFor,
  type NodeStationRun,
  type StationEnv,
} from "../stations/index.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

// The published node's shape, parsed not asserted: params crossed a process boundary (Floor → Postgres jsonb → router), so a cast through `unknown` would let a dropped field surface as `undefined` deep inside a station wearing the wrong name; parsing at the door names it instead.
export const PublishedNode = z.object({
  stationRunId: z.string().min(1),
  assemblyLineId: z.string().min(1),
  nodeId: z.string().min(1),
  iteration: z.number().int().nonnegative(),
  nodeType: z.string().min(1),
  repo: z.string(),
  // Nullable because a legitimate run (every detect-family run) has no branch; rejecting it here would dead-letter after 5 silent retries, so a station that needs one fails on its own terms as a recorded outcome instead.
  branch: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  // A node may legitimately take none.
  params: z.record(z.string(), z.string()).default({}),
});

export type PublishedNode = z.infer<typeof PublishedNode>;

export function parsePublishedNode(payload: unknown): PublishedNode {
  const parsed = PublishedNode.safeParse(payload);

  enforceTrue(
    parsed.success,
    Error,
    `station.run payload is not a node: ${parsed.success ? "" : parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
  );

  return parsed.data;
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
  // The RUNNER, not the module: needs nothing else from the manifest, and a narrower seam is one a test can satisfy with the function under test.
  run: NodeStationRun | undefined = nodeStationFor(event.nodeType)?.run,
): Promise<void> {
  const input: StationInput = {
    assembly_run_id: event.assemblyLineId,
    node_id: event.nodeId,
    node_type: event.nodeType,
    repo: event.repo,
    branch: event.branch ?? "",
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
    // Produced args ride the resume's args channel (FR6.17), merged into the line before the walk advances — the pooled-service equivalent of a pod's sink artifacts; extras (routing/telemetry) deliberately do not.
    result.args ?? {},
    result,
  );
}
