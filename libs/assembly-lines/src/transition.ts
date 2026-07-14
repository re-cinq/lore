// Pure transition logic for the event-driven walk: the executor's edge selection
// and back-edge accounting, replayed over persisted node rows instead of an
// in-process loop. `nextTransition` derives "what happens next" purely from the
// definition + the visit history, so duplicate/concurrent advancers converge and
// a Floor restart loses nothing (spec 6-dark-factory FR6).

import type { AssemblyLine, AssemblyLineEdge } from "./loader.js";
import type { StageOutcome } from "./assembly-line-executor.js";

/** One node row's contribution to the walk state (outcome null = still running). */
export interface NodeVisit {
  nodeId: string;
  iteration: number;
  outcome: StageOutcome | null;
}

export type Transition =
  | { kind: "launch"; nodeId: string; iteration: number }
  | { kind: "await" }
  | { kind: "finish" }
  | { kind: "fail"; outcome: "iteration_max" | "error"; reason: string };

const DEFAULT_MAX_NODES = 200;

/** The executor's edge rule, extracted: exact-outcome match preferred over `always`;
 *  null when nothing matches. */
export function selectEdge(
  assemblyLine: AssemblyLine,
  from: string,
  outcome: StageOutcome,
): AssemblyLineEdge | null {
  const candidates = assemblyLine.edges.filter(
    (e) => e.from === from && (e.on === outcome || e.on === "always"),
  );

  return candidates.find((e) => e.on === outcome) ?? candidates[0] ?? null;
}

/**
 * Replay the visit history through the executor's exact routing and return what
 * happens next. Iteration accounting mirrors `executeAssemblyLine`: only an
 * `iteration_max`-carrying edge (back-edge) bumps the iteration, and exceeding
 * its budget fails the line.
 */
export function nextTransition(
  assemblyLine: AssemblyLine,
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

  for (const visit of visits) {
    if (visit.nodeId !== currentId || visit.iteration !== iteration) {
      // Both node id AND iteration must match the recomputed walk — a row
      // persisted with a wrong iteration would otherwise replay cleanly while B2
      // CASes against a different iteration's rows (silent split-brain).
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

    if (chosen.iteration_max !== undefined) {
      const key = `${chosen.from}->${chosen.to}`;
      const count = (backEdgeCounts.get(key) ?? 0) + 1;

      if (count > chosen.iteration_max) {
        return {
          kind: "fail",
          outcome: "iteration_max",
          reason: `AssemblyLine ${assemblyLine.name}: edge ${key} exceeded iteration_max ${chosen.iteration_max}`,
        };
      }
      backEdgeCounts.set(key, count);
      iteration = count + 1;
    }

    currentId = chosen.to;
  }

  if (currentId === assemblyLine.exit) {
    return { kind: "finish" };
  }

  return { kind: "launch", nodeId: currentId, iteration };
}
