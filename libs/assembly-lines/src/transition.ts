// Pure transition logic for the event-driven walk: the executor's edge selection
// and back-edge accounting, replayed over persisted node rows instead of an
// in-process loop. `nextTransition` derives "what happens next" purely from the
// definition + the visit history, so duplicate/concurrent advancers converge and
// a Floor restart loses nothing (spec 6-dark-factory FR6).

/**
 * What the walk actually reads: an identity, an entry, an exit, and edges. NOT the
 * whole blueprint — narrowing it to this is what lets one replay serve both a
 * freshly loaded definition and the CLONE a run carries (FR6.38), with no
 * conversion between them and no second copy of the routing rules.
 *
 * `on` is a plain string rather than the loader's union so a graph read back out
 * of jsonb satisfies it; the routing below compares it, never switches on it.
 */
export interface WalkEdge {
  from: string;
  to: string;
  on: string;
  iteration_max?: number;
}

/** The slice of a node the walk reads: gate flags only. Nodes are optional on
 *  the graph — a clone stamped before goal gates existed carries none, and a
 *  graph without them simply has no gates to enforce. */
export interface WalkNode {
  id: string;
  goal_gate?: boolean;
}

export interface WalkGraph {
  name: string;
  entry: string;
  exit: string;
  nodes?: readonly WalkNode[];
  edges: readonly WalkEdge[];
}
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

const DEFAULT_MAX_NODES = 200;

/** The executor's edge rule, extracted: exact-outcome match preferred over `always`;
 *  null when nothing matches. */
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

/** A completed node whose outcome counts as reaching its goal. `changes_requested`
 *  qualifies: a review that produced a verdict did its job, it is not a failure.
 *
 *  These are review-SHAPED semantics, but `goal_gate` is accepted on any node
 *  type, so a gated `validate` or `gate` node inherits them unchanged — its
 *  `changes_requested` would satisfy its gate too. No builtin station emits that
 *  outcome (only agent output carries the verdict lines), so the case is
 *  unreachable today; narrowing per node type waits until a definition needs it. */
function satisfiesGate(outcome: StageOutcome | null): boolean {
  return outcome === "success" || outcome === "changes_requested";
}

/** Goal-gated nodes whose LATEST visit is not success-class. Only the latest one
 *  counts: an earlier verdict applied to an earlier state of the branch, so a
 *  stale pass cannot carry a failed re-run and a stale rejection cannot sink a
 *  clean one. A node conditional branching skipped has no visit at all, so it
 *  is unmet.
 *
 *  "Latest" is last-wins over `visits`, which relies on the array being in walk
 *  order. That is not an assumption, it is already proven when this runs: the
 *  caller only reaches the gate check after the replay loop has consumed every
 *  visit, and that loop hard-fails (`error`, "node rows diverge") on the first
 *  row whose node id or iteration does not match the recomputed walk. An
 *  out-of-order history therefore fails before it can reach a gate verdict.
 *  Deliberately not defended with a sort here — that would mask the divergence
 *  check and let a genuinely corrupt history replay as a clean gate result. */
function unmetGates(assemblyLine: WalkGraph, visits: NodeVisit[]): string[] {
  const latest = new Map<string, StageOutcome | null>();

  for (const v of visits) {
    latest.set(v.nodeId, v.outcome);
  }

  return (assemblyLine.nodes ?? [])
    .filter((n) => n.goal_gate && !satisfiesGate(latest.get(n.id) ?? null))
    .map((n) => n.id);
}

/**
 * Replay the visit history and return what happens next. This is now the sole
 * definition of the walk's routing (the in-process `executeAssemblyLine` it was
 * extracted from is retired): an edge that returns to an ALREADY-VISITED node bumps
 * the iteration, and a budgeted edge additionally fails the line past its
 * `iteration_max`.
 *
 * The bump is keyed on the revisit rather than on the budget because a node's
 * storage identity is (nodeId, iteration): a second visit that reused the first's
 * number would collide on the persisted row and on the Agent CR name derived from
 * it. That was invisible while every back-edge carried `iteration_max` — the two
 * rules picked out the same edges — and stopped being true with the human-gated
 * unbounded back-edge, where a person decides each pass and no budget applies.
 */
export function nextTransition(
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
  const visited = new Set<string>();

  for (const visit of visits) {
    visited.add(visit.nodeId);

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

    if (chosen.iteration_max !== undefined || visited.has(chosen.to)) {
      const key = `${chosen.from}->${chosen.to}`;
      const count = (backEdgeCounts.get(key) ?? 0) + 1;

      if (chosen.iteration_max !== undefined && count > chosen.iteration_max) {
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

  if (currentId !== assemblyLine.exit) {
    return { kind: "launch", nodeId: currentId, iteration };
  }

  const unmet = unmetGates(assemblyLine, visits);

  if (unmet.length === 0) {
    return { kind: "finish" };
  }

  return {
    kind: "fail",
    outcome: "goal_gate_unmet",
    reason: `AssemblyLine ${assemblyLine.name}: reached the exit with unsatisfied goal gate(s) ${unmet
      .map((id) => `"${id}"`)
      .join(", ")}`,
  };
}
