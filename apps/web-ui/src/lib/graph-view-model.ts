// Map (definition, optional run data, mode) to drawable nodes and connectors.

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
  /** Outcomes leaving this node, listed if they all lead to same next step. */
  outcomes: readonly string[];
  /** Run mode: this node's recorded verdict, or null (still running / not a run). */
  verdict: string | null;
  /** Run mode: live execution status, the badge fallback when there is no verdict. */
  status: NodeRunStatus;
  /** Run mode: on the reached terminal, the run's final result. Null elsewhere. */
  result: string | null;
  /** Node's declared type; HUMAN station says whose move. */
  nodeType?: DefinitionNode["type"];
}

export interface VisibleEdge {
  from: string;
  to: string;
  tone: ConnectorTone;
  /** Run mode: did the walk traverse this hop? */
  taken?: boolean;
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

/** One drawn connector per node pair, however many conditions route along it. */
function pairKey(from: string, to: string): string {
  return `${from}->${to}`;
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

    // Outcomes live in source node; connector never repeats verdict.
    outcomesByNode.set(
      node.id,
      outgoing.map((edge) => edge.on),
    );

    if (targets.length === 1) {
      edges.push({ from: node.id, to: targets[0], tone: "neutral" });
      continue;
    }

    targets.forEach((to) => {
      const ons = outgoing
        .filter((edge) => edge.to === to)
        .map((edge) => edge.on);

      edges.push({
        from: node.id,
        to,
        tone: ons.length === 1 ? outcomeTone(ons[0]) : "neutral",
      });
    });
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

/** Run mode: whole line with each step's current state; path so far stands out. */
function runGraph(
  definition: AssemblyLineDefinition,
  run: RunData,
): VisibleGraph {
  const reached = new Set(run.executed);
  const takenPairs = new Set<string>();

  // Collected before connectors built; several conditions can share one hop.
  for (const edge of definition.edges) {
    if (run.taken.has(edgeKey(edge))) {
      takenPairs.add(pairKey(edge.from, edge.to));
      reached.add(edge.from);
      reached.add(edge.to);
    }
  }

  const seen = new Set<string>();
  const edges: VisibleEdge[] = [];

  for (const edge of definition.edges) {
    const pair = pairKey(edge.from, edge.to);

    if (seen.has(pair)) {
      continue;
    }

    seen.add(pair);
    edges.push({
      from: edge.from,
      to: edge.to,
      tone: "neutral",
      taken: takenPairs.has(pair),
    });
  }

  const terminals = terminalIds(definition);
  const nodes = definition.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    outcomes: [],
    verdict: run.verdicts[node.id] ?? null,
    status: run.statuses[node.id] ?? "idle",
    // Only reached terminals carry the result.
    result: terminals.has(node.id) && reached.has(node.id) ? run.result : null,
    nodeType: node.type,
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
