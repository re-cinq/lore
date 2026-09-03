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

  return candidates.find((e) => e.on === outcome) ?? candidates[0] ?? null;
}

// Replay the visit history for what happens next (sole routing definition, `executeAssemblyLine` retired): a revisited node bumps the iteration, and a budgeted edge additionally fails past its `iteration_max`.

// The bump keys on the revisit, not the budget: (nodeId, iteration) is the row/Agent-CR identity, and the human-gated unbounded back-edge has no budget to key on instead.
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

  let currentId = assemblyLine.entry;
  let iteration = 1;
  const backEdgeCounts = new Map<string, number>();
  // A revisit must number past every prior row for that node (not just this edge's count) — two back-edges into the same target could otherwise collide.
  const highestIteration = new Map<string, number>();
  const visited = new Set<string>();

  for (const visit of visits) {
    visited.add(visit.nodeId);
    highestIteration.set(
      visit.nodeId,
      Math.max(highestIteration.get(visit.nodeId) ?? 0, visit.iteration),
    );

    if (visit.nodeId !== currentId || visit.iteration !== iteration) {
      // Node id AND iteration must both match the recomputed walk, or a wrong-iteration row replays cleanly while CAS hits a different iteration's rows (silent split-brain).
      return {
        kind: "fail",
        outcome: "error",
        reason: `AssemblyLine ${assemblyLine.name}: node rows diverge from the definition (recorded "${visit.nodeId}" iter ${visit.iteration}, expected "${currentId}" iter ${iteration})`,
      };
    }

    const chosen = selectEdge(assemblyLine, visit.nodeId, visit.outcome!);

    if (!chosen) {
      return {
        kind: "fail",
        outcome: "error",
        reason: `AssemblyLine ${assemblyLine.name}: no edge from "${visit.nodeId}" for outcome "${visit.outcome}"`,
      };
    }

    if (chosen.iteration_max === undefined && !visited.has(chosen.to)) {
      currentId = chosen.to;
      continue;
    }

    // Permanent failures (balance/credential/permission) can't be helped by a retry, so refuse it and say what died — but only the back-edge is suppressed; a forward `failed` edge (to retrospective/exit) still routes.
    if (isPermanentNodeFailure(visit)) {
      return {
        kind: "fail",
        outcome: "error",
        reason: `AssemblyLine ${assemblyLine.name}: ${nodeFailureReason(visit)}`,
      };
    }
    const key = `${chosen.from}->${chosen.to}`;
    const count = (backEdgeCounts.get(key) ?? 0) + 1;

    if (chosen.iteration_max !== undefined && count > chosen.iteration_max) {
      // The budget is HOW the run ended; the visit is WHY — report what the station actually said, not just the exhausted edge.
      return {
        kind: "fail",
        outcome: "iteration_max",
        reason: `AssemblyLine ${assemblyLine.name}: ${nodeFailureReason(visit)} — the ${key} retry budget (${chosen.iteration_max}) is spent`,
      };
    }
    backEdgeCounts.set(key, count);
    iteration = (highestIteration.get(chosen.to) ?? 0) + 1;
    currentId = chosen.to;
  }

  if (currentId === assemblyLine.exit) {
    return { kind: "finish" };
  }

  return { kind: "launch", nodeId: currentId, iteration };
}
