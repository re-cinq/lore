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
  /** The NODE's attempt, not the planning round's — a node sent back for a
   *  correction mints a new row, and the two counts are unrelated. */
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

/** Whose move it is, straight off a HUMAN station's declared type (FR6.40).
 *
 *  This takes PRECEDENCE over the node-id map below, which is what removes the
 *  fragile half: a human station added or renamed in the blueprint reports its
 *  phase without anyone remembering to edit a list in the view. */
const HUMAN_STATION_PHASE: Record<string, FeaturePhase["kind"]> = {
  feature_review: "awaiting-author",
  pr_review: "awaiting-merge",
};

/**
 * Node id -> the STAGE it belongs to, for the nodes a person is not working.
 *
 * This half is NOT derivable and is not pretending to be: `analyze`, `write` and
 * `decompose` are all `agent` nodes, so the type says nothing about which stage of
 * a feature they serve. Deriving it would need the blueprint to declare a phase per
 * node — a real option, and the only way to delete this map outright. Until then it
 * is domain knowledge about ONE blueprint living in the view, and a node added to
 * feature-planning without an entry here reports no phase.
 *
 * The spec nodes share one phase because the author has no decision to make while
 * any of them runs.
 */
const NODE_PHASE: Record<string, FeaturePhase["kind"]> = {
  analyze: "planning",
  // The two human stations are ALSO listed here, as the fallback for runs stamped
  // before clones existed: those carry no graph, so their type cannot be read and
  // the id is all there is. A run that HAS a graph never reaches these entries.
  author: "awaiting-author",
  merged: "awaiting-merge",
  "analyse-specs": "writing-spec",
  write: "writing-spec",
  push: "writing-spec",
  decompose: "decomposing",
  issues: "decomposing",
};

/** A task state that means the round is still going. Any other value means it
 *  settled — ready or failed, but not running. */
const RUNNING_TASK_STATUSES = new Set(["pending", "queued", "running"]);

export interface FeaturePhaseInput {
  run?: {
    status: string;
    outcome?: string | null;
    nodes: readonly AssemblyLineRunNode[];
    /** The run's own graph, so a human station's phase reads off its declared
     *  type rather than off a transcribed list of node ids. */
    graph?: { nodes: readonly { id: string; type: string }[] } | null;
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
  const kind = working
    ? (HUMAN_STATION_PHASE[
        run.graph?.nodes.find((n) => n.id === working.nodeId)?.type ?? ""
      ] ?? NODE_PHASE[working.nodeId])
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
