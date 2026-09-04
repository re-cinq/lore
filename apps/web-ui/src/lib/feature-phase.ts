// Feature's current phase; used instead of stale feature.status since assembly line knows what's running.

import type { AssemblyRunNode } from "./assembly-runs";
import type { FeatureStatus } from "./feature-types";
import { humanStation } from "./human-station";
import { isPlanningActive } from "@/app/repos/[owner]/[repo]/features/feature-status";

/** Node currently working, with start time for elapsed timer. */
interface Working {
  nodeId: string;
  since?: string;
  /** The NODE's attempt count, not the round's. */
  nodeIteration?: number;
}

export type FeaturePhase =
  | ({ kind: "planning" } & Partial<Working>)
  | ({ kind: "awaiting-author" } & Partial<Working>)
  | ({ kind: "writing-spec" } & Working)
  | ({ kind: "awaiting-merge" } & Working)
  | ({ kind: "decomposing" } & Working)
  | { kind: "done" }
  | { kind: "failed" };

/** Map of node IDs to phases; human stations use type when graph available. */
const NODE_PHASE: Record<string, FeaturePhase["kind"]> = {
  analyze: "planning",
  author: "awaiting-author",
  merged: "awaiting-merge",
  "analyse-specs": "writing-spec",
  write: "writing-spec",
  push: "writing-spec",
  decompose: "decomposing",
  issues: "decomposing",
};

/** Task state means round still going. */
const RUNNING_TASK_STATUSES = new Set(["pending", "queued", "running"]);

export interface FeaturePhaseInput {
  run?: {
    status: string;
    outcome?: string | null;
    nodes: readonly AssemblyRunNode[];
    /** Run's own graph for human station phase lookup by type. */
    graph?: { nodes: readonly { id: string; type: string }[] } | null;
  } | null;
  feature: { status: FeatureStatus };
  latestIteration?: { status: string; gap_result: unknown } | null;
  task?: { status: string } | null;
}

/** Feature's current phase from assembly line or fallback legacy logic. */
export function featurePhaseOf(input: FeaturePhaseInput): FeaturePhase {
  const fromLine = phaseFromLine(input.run);

  return fromLine ?? phaseFromRound(input);
}

type Run = NonNullable<FeaturePhaseInput["run"]>;

function hasFailedNode(nodes: readonly AssemblyRunNode[]): boolean {
  return nodes.some((n) => n.outcome !== null && isFailure(n.outcome));
}

function isLineActive(status: string): boolean {
  return status === "running" || status === "queued";
}

function terminalPhase(run: Run): FeaturePhase {
  return run.outcome && isFailure(run.outcome)
    ? { kind: "failed" }
    : { kind: "done" };
}

/** Last open row; revisit mints a new one (FR6.40). */
function lastOpenNode(
  nodes: readonly AssemblyRunNode[],
): AssemblyRunNode | undefined {
  return [...nodes].reverse().find((n) => n.outcome === null);
}

function phaseKindFor(
  run: Run,
  nodeId: string,
): FeaturePhase["kind"] | undefined {
  const nodeType = run.graph?.nodes.find((n) => n.id === nodeId)?.type;

  return humanStation(nodeType)?.phase ?? NODE_PHASE[nodeId];
}

function workingPhase(
  run: Run,
  working: AssemblyRunNode | undefined,
): FeaturePhase | null {
  const kind = working ? phaseKindFor(run, working.nodeId) : undefined;

  if (!working || !kind) {
    return null;
  }

  return {
    kind,
    nodeId: working.nodeId,
    since: working.startedAt,
    nodeIteration: working.iteration,
  } as FeaturePhase;
}

/** The phase the line reports, or null when the line cannot say. */
function phaseFromLine(run: FeaturePhaseInput["run"]): FeaturePhase | null {
  if (!run) {
    return null;
  }

  if (hasFailedNode(run.nodes)) {
    return { kind: "failed" };
  }

  if (!isLineActive(run.status)) {
    return terminalPhase(run);
  }

  return workingPhase(run, lastOpenNode(run.nodes));
}

function isTaskActive(task: FeaturePhaseInput["task"]): boolean {
  return !task || RUNNING_TASK_STATUSES.has(task.status);
}

function isRoundReady(latest: FeaturePhaseInput["latestIteration"]): boolean {
  return latest?.status === "ready" && !!latest.gap_result;
}

/** Settled but unusable: detect when round already died. */
function roundSettledFailed(
  task: FeaturePhaseInput["task"],
  latest: FeaturePhaseInput["latestIteration"],
): boolean {
  return task?.status === "failed" || latest?.status === "failed";
}

function unusableRound(ready: boolean, taskActive: boolean): boolean {
  return !ready && !taskActive;
}

function isRoundPlanning(
  latest: FeaturePhaseInput["latestIteration"],
): boolean {
  return !latest || latest.status === "running";
}

/** The pre-merged-line derivation, kept for features that resolve no line. */
function phaseFromRound(input: FeaturePhaseInput): FeaturePhase {
  if (!isPlanningActive(input.feature.status)) {
    return { kind: "done" };
  }
  const { latestIteration: latest, task } = input;

  if (roundSettledFailed(task, latest)) {
    return { kind: "failed" };
  }

  if (unusableRound(isRoundReady(latest), isTaskActive(task))) {
    return { kind: "failed" };
  }

  return isRoundPlanning(latest)
    ? { kind: "planning" }
    : { kind: "awaiting-author" };
}

function isFailure(outcome: string): boolean {
  return outcome.includes("failed");
}
