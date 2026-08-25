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

import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  nodeStationFor,
  type NodeStationRun,
  type StationEnv,
} from "../stations/index.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

/**
 * The published node's shape, parsed rather than asserted.
 *
 * These params crossed a process boundary: the Floor wrote them, Postgres
 * stored them as jsonb, the router handed them back. A cast through `unknown`
 * makes the compiler agree to whatever arrives, so a field the publisher stops
 * sending reaches a station as `undefined` and fails somewhere further in,
 * wearing the station's name rather than the publisher's. Parsing at the door
 * names the field instead.
 */
export const PublishedNode = z.object({
  stationRunId: z.string().min(1),
  assemblyLineId: z.string().min(1),
  nodeId: z.string().min(1),
  iteration: z.number().int().nonnegative(),
  nodeType: z.string().min(1),
  repo: z.string(),
  // Nullable because a run may legitimately have no branch — every detect-family
  // run in production does. Rejecting it here would dead-letter the delivery
  // after five silent retries; a station that actually needs a branch fails on
  // its own terms instead, which is a recorded node outcome rather than a
  // vanished one.
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
  // The RUNNER, not the module: this needs nothing else from the manifest, and a
  // narrower seam is one a test can satisfy with the function under test.
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
    // Produced args ride the resume's args channel (FR6.17) and are merged into
    // the line before the walk advances — the pooled-service equivalent of a
    // pod's sink artifacts. Extras deliberately do not: they are routing and
    // telemetry, not the next node's brief.
    result.args ?? {},
    result,
  );
}
