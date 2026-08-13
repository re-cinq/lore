// The selector between a workflow's static definition and one run of it. Pure:
// it maps (definition, optional run data, mode) to the nodes and connectors the
// graph should actually draw, so the renderer stays a dumb function of this model
// and never re-derives "what executed" from presentation state.
//
// Run mode tells one story — the path that ran — so it draws only executed nodes,
// one neutral connector per hop, the verdict on each node and the result on the
// terminal; the unused outcomes are not competing branches. Definition mode shows
// what the workflow can do: outcomes that all lead to the same next step collapse
// into one connector and list inside the source node, while outcomes that branch
// to different steps stay separate and color-coded.

import type {
  AssemblyLineDefinition,
  DefinitionNode,
} from "./assembly-line-definition";
import type { NodeRunStatus } from "./run-event-reducer";
import { edgeKey } from "./run-taken-edges";

export type GraphMode = "run" | "definition";
export type ConnectorTone = "ok" | "warn" | "err" | "neutral";

/** One run's execution facts — no presentation, no layout. */
export interface RunData {
  /** Node ids that participated in the run. */
  executed: ReadonlySet<string>;
  /** Recorded verdict per node (success / changes_requested / <kind>-failed). */
  verdicts: Readonly<Record<string, string | null>>;
  /** Live execution status per node — the badge fallback before a verdict lands. */
  statuses: Readonly<Record<string, NodeRunStatus>>;
  /** Keys (`${from}-${to}-${on}`) of the edges the walk traversed. */
  taken: ReadonlySet<string>;
  /** The run's final result token (e.g. "completed" / "failed"), null while live. */
  result: string | null;
}

export interface VisibleNode {
  id: string;
  type: string;
  /** Definition mode: the outcomes leaving this node, listed inside it when they
   *  all lead to the same next step. Empty otherwise. */
  outcomes: readonly string[];
  /** Run mode: this node's recorded verdict, or null (still running / not a run). */
  verdict: string | null;
  /** Run mode: live execution status, the badge fallback when there is no verdict. */
  status: NodeRunStatus;
  /** Run mode: on the reached terminal, the run's final result. Null elsewhere. */
  result: string | null;
  /** For a `wait` node: whose move it is while the node sits open. */
  signal?: DefinitionNode["signal"];
}

export interface VisibleEdge {
  from: string;
  to: string;
  tone: ConnectorTone;
}

export interface VisibleGraph {
  mode: GraphMode;
  nodes: readonly VisibleNode[];
  edges: readonly VisibleEdge[];
}

/** Outcome (or edge condition) to a connector/badge tone. */
export function outcomeTone(outcome: string): ConnectorTone {
  if (outcome.includes("failed")) {
    return "err";
  }

  if (outcome === "changes_requested") {
    return "warn";
  }

  return outcome === "success" ? "ok" : "neutral";
}

function terminalIds(definition: AssemblyLineDefinition): Set<string> {
  const hasOutgoing = new Set(definition.edges.map((edge) => edge.from));

  return new Set(
    definition.nodes
      .map((node) => node.id)
      .filter((id) => !hasOutgoing.has(id)),
  );
}

/** Definition mode: collapse same-target outcomes, branch different-target ones. */
function definitionGraph(definition: AssemblyLineDefinition): VisibleGraph {
  const edges: VisibleEdge[] = [];
  const outcomesByNode = new Map<string, string[]>();

  for (const node of definition.nodes) {
    const outgoing = definition.edges.filter((edge) => edge.from === node.id);
    const targets = [...new Set(outgoing.map((edge) => edge.to))];

    // The outcomes always live inside the source node (with their icons); the
    // connector never repeats the verdict (design rule). One target → one neutral
    // connector; several → one colored branch per target, color-coded, no label.
    outcomesByNode.set(
      node.id,
      outgoing.map((edge) => edge.on),
    );

    if (targets.length === 1) {
      edges.push({ from: node.id, to: targets[0], tone: "neutral" });
      continue;
    }

    for (const to of targets) {
      const ons = outgoing
        .filter((edge) => edge.to === to)
        .map((edge) => edge.on);

      edges.push({
        from: node.id,
        to,
        tone: ons.length === 1 ? outcomeTone(ons[0]) : "neutral",
      });
    }
  }

  const nodes = definition.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    outcomes: outcomesByNode.get(node.id) ?? [],
    verdict: null,
    status: "idle" as const,
    result: null,
  }));

  return { mode: "definition", nodes, edges };
}

/** Run mode: only the executed nodes and the connectors the walk actually took. */
function runGraph(
  definition: AssemblyLineDefinition,
  run: RunData,
): VisibleGraph {
  const takenEdges = definition.edges.filter((edge) =>
    run.taken.has(edgeKey(edge)),
  );
  const involved = new Set(run.executed);
  const seen = new Set<string>();
  const edges: VisibleEdge[] = [];

  for (const edge of takenEdges) {
    involved.add(edge.from);
    involved.add(edge.to);

    const pair = `${edge.from}->${edge.to}`;

    if (seen.has(pair)) {
      continue;
    }

    seen.add(pair);
    edges.push({ from: edge.from, to: edge.to, tone: "neutral" });
  }

  const terminals = terminalIds(definition);
  const nodes = definition.nodes
    .filter((node) => involved.has(node.id))
    .map((node) => ({
      id: node.id,
      type: node.type,
      outcomes: [],
      verdict: run.verdicts[node.id] ?? null,
      status: run.statuses[node.id] ?? "idle",
      result: terminals.has(node.id) ? run.result : null,
      signal: node.signal,
    }));

  return { mode: "run", nodes, edges };
}

/** The nodes and connectors to draw for the active mode. */
export function deriveVisibleGraph(
  definition: AssemblyLineDefinition | null,
  run: RunData | null,
  mode: GraphMode,
): VisibleGraph {
  if (!definition) {
    return { mode, nodes: [], edges: [] };
  }

  return mode === "run" && run
    ? runGraph(definition, run)
    : definitionGraph(definition);
}
