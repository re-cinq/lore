// Which definition edge each visited node actually traversed, derived from the
// walk rows' outcomes. The live reducer collapses an outcome to succeeded/failed
// and loses the verdict the edge acts on (`changes_requested` reads as succeeded),
// so the taken branch is read from the persisted rows, not from node status.
//
// This mirrors the intent of the server-side edge selection (libs/assembly-lines
// selectEdge) with only the node outcome in hand: prefer an exact `on` match,
// then a `<kind>-<on>` suffix (a station emits `review-failed` for the `failed`
// edge), then fall back to an unconditional `always` edge.

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

/**
 * The edge a node traversed given its outcome, or null while it is still running
 * or when nothing matches. Shared by the taken-path overlay and the step list so
 * both read the walk the same way.
 */
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

/**
 * The keys of every edge a completed node traversed. A node still running (null
 * outcome) has taken no edge yet and contributes nothing.
 */
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
