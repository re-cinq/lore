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

/** The phase the line reports, or null when the line cannot say. */
function phaseFromLine(run: FeaturePhaseInput["run"]): FeaturePhase | null {
  if (!run) {
    return null;
  }

  if (run.nodes.some((n) => n.outcome !== null && isFailure(n.outcome))) {
    return { kind: "failed" };
  }

  if (run.status !== "running" && run.status !== "queued") {
    return run.outcome && isFailure(run.outcome)
      ? { kind: "failed" }
      : { kind: "done" };
  }
  // Last open row; revisit mints a new one (FR6.40).
  const working = [...run.nodes].reverse().find((n) => n.outcome === null);
  const kind = working
    ? (humanStation(run.graph?.nodes.find((n) => n.id === working.nodeId)?.type)
        ?.phase ?? NODE_PHASE[working.nodeId])
    : undefined;

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

/** The pre-merged-line derivation, kept for features that resolve no line. */
function phaseFromRound(input: FeaturePhaseInput): FeaturePhase {
  if (!isPlanningActive(input.feature.status)) {
    return { kind: "done" };
  }
  const latest = input.latestIteration;
  const task = input.task;
  const taskActive = !task || RUNNING_TASK_STATUSES.has(task.status);
  const ready = latest?.status === "ready" && !!latest.gap_result;

  // Settled but unusable: detect when round already died.
  if (task?.status === "failed" || latest?.status === "failed") {
    return { kind: "failed" };
  }

  if (!ready && !taskActive) {
    return { kind: "failed" };
  }

  if (!latest || latest.status === "running") {
    return { kind: "planning" };
  }

  return { kind: "awaiting-author" };
}

function isFailure(outcome: string): boolean {
  return outcome.includes("failed");
}
