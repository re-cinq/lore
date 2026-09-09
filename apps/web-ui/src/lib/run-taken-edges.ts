// Derives taken edges from walk rows using selectEdge logic (exact match → suffix match → fallback).

import type {
  AssemblyLineDefinition,
  DefinitionEdge,
} from "./assembly-line-definition";
import type { AssemblyRunNode } from "./assembly-runs";

/** Stable key matching RunGraphView's edgeKey: `${from}-${to}-${on}`. */
export function edgeKey(
  edge: Pick<DefinitionEdge, "from" | "to" | "on">,
): string {
  return `${edge.from}-${edge.to}-${edge.on}`;
}

function pickEdge(
  outgoing: readonly DefinitionEdge[],
  outcome: string,
): DefinitionEdge | null {
  return (
    outgoing.find((edge) => edge.on === outcome) ??
    outgoing.find((edge) => outcome.endsWith(`-${edge.on}`)) ??
    outgoing.find((edge) => edge.on === "always") ??
    null
  );
}

/** Edge a node traversed, or null while running or unmatched; shared by taken-path overlay and step list. */
export function chosenEdge(
  definition: AssemblyLineDefinition | null,
  nodeId: string,
  outcome: string | null,
): DefinitionEdge | null {
  if (!definition || outcome === null) {
    return null;
  }

  return pickEdge(
    definition.edges.filter((edge) => edge.from === nodeId),
    outcome,
  );
}

/** Keys of every edge a completed node traversed; running nodes contribute nothing. */
export function takenEdgeKeys(
  definition: AssemblyLineDefinition | null,
  nodes: readonly AssemblyRunNode[],
): Set<string> {
  const keys = new Set<string>();

  if (!definition) {
    return keys;
  }

  for (const node of nodes) {
    const chosen = chosenEdge(definition, node.nodeId, node.outcome);

    if (chosen) {
      keys.add(edgeKey(chosen));
    }
  }

  return keys;
}
