// What a feature is doing right now, as one value.
//
// The planning view used to decide this from `feature.status` plus five booleans
// rebuilt in the wizard from the round's task (`taskActive`, `latestReady`,
// `settledUnusable`, `failed`, `running`). That is fragile for a concrete reason:
// `feature.status` has no live writer for `pr-open`, so the column the view branched
// on is stale by design. The assembly line knows what is actually running.
//
// Deliberately its OWN module with a TYPE-ONLY import of the node row: the wizard is
// a client component, and a value import from feature-run.ts pulls that module's
// `db` -> `pg` chain into the browser bundle ("Can't resolve 'fs'"). This replaces
// spec-phase.ts, which carried the same constraint and covered only the spec half.

import type { AssemblyLineRunNode } from "./assembly-line-runs";
import type { FeatureStatus } from "./feature-types";
import { isPlanningActive } from "@/app/repos/[owner]/[repo]/features/feature-status";

/** Which node a phase is working, and when that node started — so an elapsed timer
 *  counts from the NODE rather than from the round that contains it. */
interface Working {
  nodeId: string;
  since?: string;
}

export type FeaturePhase =
  | ({ kind: "planning" } & Partial<Working>)
  | ({ kind: "awaiting-author" } & Partial<Working>)
  | ({ kind: "writing-spec" } & Working)
  | { kind: "done" }
  | { kind: "failed" };

/** Node id -> the phase it represents. The spec nodes share one phase because the
 *  author has no decision to make while any of them runs. */
const NODE_PHASE: Record<string, FeaturePhase["kind"]> = {
  analyze: "planning",
  author: "awaiting-author",
  "analyse-specs": "writing-spec",
  write: "writing-spec",
  push: "writing-spec",
};

/** A task state that means the round is still going. Any other value means it
 *  settled — ready or failed, but not running. */
const RUNNING_TASK_STATUSES = new Set(["pending", "queued", "running"]);

export interface FeaturePhaseInput {
  run?: {
    status: string;
    outcome?: string | null;
    nodes: readonly AssemblyLineRunNode[];
  } | null;
  feature: { status: FeatureStatus };
  latestIteration?: { status: string; gap_result: unknown } | null;
  task?: { status: string } | null;
}

/**
 * The feature's current phase.
 *
 * The line decides when it can: its open (`outcome === null`) rows say which node is
 * working. When no line resolves — a legacy feature that minted a task per round —
 * the round's own rows decide instead, which is the behaviour the wizard had before.
 */
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
  // The LAST open row: a revisit mints a new one, and an earlier open row is a node
  // the walk has already moved past.
  const working = [...run.nodes].reverse().find((n) => n.outcome === null);
  const kind = working ? NODE_PHASE[working.nodeId] : undefined;

  if (!working || !kind) {
    return null;
  }

  return {
    kind,
    nodeId: working.nodeId,
    since: working.startedAt,
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

  // Settled but unusable: the task ended and the round produced nothing. Without
  // this the view spins forever on a round that already died.
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
