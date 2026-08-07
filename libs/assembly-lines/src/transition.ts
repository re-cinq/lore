// Pure transition logic for the event-driven walk: the executor's edge selection
// and back-edge accounting, replayed over persisted node rows instead of an
// in-process loop. `nextTransition` derives "what happens next" purely from the
// definition + the visit history, so duplicate/concurrent advancers converge and
// a Floor restart loses nothing (spec 6-dark-factory FR6).

import type { AssemblyLine, AssemblyLineEdge } from "./loader.js";
import type { StageOutcome } from "./node-types.js";

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
  | {
      kind: "fail";
      outcome: "iteration_max" | "error" | "goal_gate_unmet";
      reason: string;
    };

/** Outcomes that satisfy a goal gate: the node ran and delivered a verdict.
 *  `changes_requested` counts — for a review node it is a completed review,
 *  not a failure (Attractor's PARTIAL_SUCCESS analogue). */
const GATE_SATISFYING: ReadonlySet<StageOutcome> = new Set([
  "success",
  "changes_requested",
]);

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
 * Replay the visit history and return what happens next. This is now the sole
 * definition of the walk's routing (the in-process `executeAssemblyLine` it was
 * extracted from is retired): only an `iteration_max`-carrying edge (back-edge)
 * bumps the iteration, and exceeding its budget fails the line.
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
    const unmetGates = assemblyLine.nodes
      .filter((n) => n.goal_gate)
      .filter(
        (n) =>
          !visits.some(
            (v) =>
              v.nodeId === n.id &&
              v.outcome !== null &&
              GATE_SATISFYING.has(v.outcome),
          ),
      )
      .map((n) => `"${n.id}"`);

    if (unmetGates.length > 0) {
      return {
        kind: "fail",
        outcome: "goal_gate_unmet",
        reason: `AssemblyLine ${assemblyLine.name}: goal-gated node(s) ${unmetGates.join(", ")} never recorded a successful outcome`,
      };
    }

    return { kind: "finish" };
  }

  return { kind: "launch", nodeId: currentId, iteration };
}
