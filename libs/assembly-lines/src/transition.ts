// Pure edge-selection + back-edge accounting replayed over persisted node rows (no in-process loop) so duplicate/concurrent advancers converge and a Floor restart loses nothing (spec 6-dark-factory FR6).

// Narrowed to identity/entry/exit/edges (not the whole blueprint) so one replay serves both a fresh definition and a run's CLONE (FR6.38); `on` is a plain string so a graph read back from jsonb satisfies it.
export interface WalkEdge {
  from: string;
  to: string;
  on: string;
  iteration_max?: number;
}

export interface WalkGraph {
  name: string;
  entry: string;
  exit: string;
  edges: readonly WalkEdge[];
}
import type { StageOutcome } from "./node-types.js";
import { isPermanentNodeFailure, nodeFailureReason } from "./failure-reason.js";

/** One node row's contribution to the walk state (outcome null = still running). */
export interface NodeVisit {
  nodeId: string;
  iteration: number;
  outcome: StageOutcome | null;
  // Floor's failure classification (migration 0042) — decides whether a retry could help; missing on pre-migration rows reads as "retry as before".
  failureClass?: string | null;
  // What the failed visit actually said (station/agent error) — rides the iteration_max terminal reason so the author reads the CAUSE, not just the exhausted edge.
  failureDetail?: string | null;
}

export type Transition =
  | { kind: "launch"; nodeId: string; iteration: number }
  | { kind: "await" }
  | { kind: "finish" }
  | { kind: "fail"; outcome: "iteration_max" | "error"; reason: string };

const DEFAULT_MAX_NODES = 200;

// The executor's edge rule: exact-outcome match preferred over `always`; null when nothing matches.
export function selectEdge(
  assemblyLine: WalkGraph,
  from: string,
  outcome: StageOutcome,
): WalkEdge | null {
  const candidates = assemblyLine.edges.filter(
    (e) => e.from === from && (e.on === outcome || e.on === "always"),
  );

  return candidates.find((e) => e.on === outcome) ?? candidates.at(0) ?? null;
}

interface WalkState {
  currentId: string;
  iteration: number;
}

interface WalkAccounting {
  backEdgeCounts: Map<string, number>;
  // A revisit must number past every prior row for that node (not just this edge's count) — two back-edges into the same target could otherwise collide.
  highestIteration: Map<string, number>;
  visited: Set<string>;
}

function recordVisit(visit: NodeVisit, accounting: WalkAccounting): void {
  accounting.visited.add(visit.nodeId);
  accounting.highestIteration.set(
    visit.nodeId,
    Math.max(
      accounting.highestIteration.get(visit.nodeId) ?? 0,
      visit.iteration,
    ),
  );
}

// Node id AND iteration must both match the recomputed walk, or a wrong-iteration row replays cleanly while CAS hits a different iteration's rows (silent split-brain).
function divergenceFailure(
  assemblyLine: WalkGraph,
  visit: NodeVisit,
  state: WalkState,
): Transition | null {
  if (visit.nodeId === state.currentId && visit.iteration === state.iteration) {
    return null;
  }

  return {
    kind: "fail",
    outcome: "error",
    reason: `AssemblyLine ${assemblyLine.name}: node rows diverge from the definition (recorded "${visit.nodeId}" iter ${visit.iteration}, expected "${state.currentId}" iter ${state.iteration})`,
  };
}

// The account or budget decision for a revisited/budgeted edge: a permanent failure refuses the retry outright, an exhausted budget fails with its own reason, otherwise the edge is spent and the walk advances to its target.
function budgetOutcome(
  assemblyLine: WalkGraph,
  visit: NodeVisit,
  chosen: WalkEdge,
  accounting: WalkAccounting,
): Transition | { nextId: string } {
  if (isPermanentNodeFailure(visit)) {
    return {
      kind: "fail",
      outcome: "error",
      reason: `AssemblyLine ${assemblyLine.name}: ${nodeFailureReason(visit)}`,
    };
  }
  const key = `${chosen.from}->${chosen.to}`;
  const count = (accounting.backEdgeCounts.get(key) ?? 0) + 1;

  if (chosen.iteration_max !== undefined && count > chosen.iteration_max) {
    // The budget is HOW the run ended; the visit is WHY — report what the station actually said, not just the exhausted edge.
    return {
      kind: "fail",
      outcome: "iteration_max",
      reason: `AssemblyLine ${assemblyLine.name}: ${nodeFailureReason(visit)} — the ${key} retry budget (${chosen.iteration_max}) is spent`,
    };
  }
  accounting.backEdgeCounts.set(key, count);

  return { nextId: chosen.to };
}

function isTransition(
  outcome: Transition | { nextId: string },
): outcome is Transition {
  return "kind" in outcome;
}

function noEdgeFailure(assemblyLine: WalkGraph, visit: NodeVisit): Transition {
  return {
    kind: "fail",
    outcome: "error",
    reason: `AssemblyLine ${assemblyLine.name}: no edge from "${visit.nodeId}" for outcome "${visit.outcome}"`,
  };
}

// A fresh forward hop with no budget just moves on — only a revisit or a budgeted edge needs the accounting below.
function isUnbudgetedForwardHop(
  chosen: WalkEdge,
  accounting: WalkAccounting,
): boolean {
  return (
    chosen.iteration_max === undefined && !accounting.visited.has(chosen.to)
  );
}

// One visit's contribution to the walk: mutates state/accounting toward the next node, or returns the Transition that ends the replay.
function applyVisit(
  assemblyLine: WalkGraph,
  visit: NodeVisit,
  state: WalkState,
  accounting: WalkAccounting,
): Transition | null {
  recordVisit(visit, accounting);
  const diverged = divergenceFailure(assemblyLine, visit, state);

  if (diverged) {
    return diverged;
  }
  const chosen = selectEdge(assemblyLine, visit.nodeId, visit.outcome!);

  if (!chosen) {
    return noEdgeFailure(assemblyLine, visit);
  }

  if (isUnbudgetedForwardHop(chosen, accounting)) {
    state.currentId = chosen.to;

    return null;
  }
  const outcome = budgetOutcome(assemblyLine, visit, chosen, accounting);

  if (isTransition(outcome)) {
    return outcome;
  }
  state.iteration = (accounting.highestIteration.get(outcome.nextId) ?? 0) + 1;
  state.currentId = outcome.nextId;

  return null;
}

function replayVisits(
  assemblyLine: WalkGraph,
  visits: NodeVisit[],
  state: WalkState,
  accounting: WalkAccounting,
): Transition | null {
  for (const visit of visits) {
    const failure = applyVisit(assemblyLine, visit, state, accounting);

    if (failure) {
      return failure;
    }
  }

  return null;
}

// Replay the visit history for what happens next (sole routing definition, `executeAssemblyLine` retired): a revisited node bumps the iteration, and a budgeted edge additionally fails past its `iteration_max`.
export function getNextTransition(
  assemblyLine: WalkGraph,
  visits: NodeVisit[],
  maxNodes = DEFAULT_MAX_NODES,
): Transition {
  if (visits.some((v) => v.outcome === null)) {
    return { kind: "await" };
  }

  if (visits.length >= maxNodes) {
    return {
      kind: "fail",
      outcome: "error",
      reason: `AssemblyLine ${assemblyLine.name}: maxNodes (${maxNodes}) reached without hitting exit`,
    };
  }

  const state: WalkState = { currentId: assemblyLine.entry, iteration: 1 };
  const accounting: WalkAccounting = {
    backEdgeCounts: new Map(),
    highestIteration: new Map(),
    visited: new Set(),
  };
  const failure = replayVisits(assemblyLine, visits, state, accounting);

  if (failure) {
    return failure;
  }

  return state.currentId === assemblyLine.exit
    ? { kind: "finish" }
    : { kind: "launch", nodeId: state.currentId, iteration: state.iteration };
}
