// Which definition graph a run should draw, resolved without IO.
//
// The Floor endpoint for this (spec FR3.2, `GET /api/assembly-line-definitions/
// {name}`) is not shipped yet, so the primary source is the hand-transcribed
// builtin set. A run of a definition outside that set — a custom line, or a
// builtin whose YAML changed after the transcription — falls back to a chain
// synthesized from the walk's own visit rows: the nodes are real, the edges are
// a presentational guess, and `synthetic` is how the caller knows to suppress
// edge labels rather than show a condition nobody asserted.

import type {
  AssemblyLineDefinition,
  DefinitionEdge,
  DefinitionNode,
} from "./assembly-line-definition";
import type { AssemblyLineRunNode } from "./assembly-line-runs";
import { builtinDefinitions } from "./builtin-definitions";

export interface RunGraphDefinition {
  definition: AssemblyLineDefinition | null;
  /** True when the graph was inferred from visit rows rather than declared. */
  synthetic: boolean;
}

/** Distinct visited node ids, in the order the walk first reached them. */
function visitedNodes(
  visitRows: readonly AssemblyLineRunNode[],
): DefinitionNode[] {
  const seen = new Set<string>();
  const nodes: DefinitionNode[] = [];

  for (const rowNode of visitRows) {
    if (seen.has(rowNode.nodeId)) {
      continue;
    }

    seen.add(rowNode.nodeId);
    nodes.push({ id: rowNode.nodeId, type: "agent" });
  }

  return nodes;
}

/**
 * Sequential `always` edges between consecutive visited nodes. Without them the
 * longest-path layering puts every node in layer 0 and the graph draws as a
 * vertical pile instead of a chain.
 */
function chainEdges(nodes: readonly DefinitionNode[]): DefinitionEdge[] {
  return nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
    on: "always" as const,
  }));
}

/**
 * The definition to draw for a run. A known name resolves to its declared
 * graph; anything else synthesizes one from the visit rows, and a run with
 * neither a known name nor a single visit row has no graph to draw at all.
 */
export function definitionForRun(
  blueprintName: string,
  visitRows: readonly AssemblyLineRunNode[],
): RunGraphDefinition {
  const builtin = builtinDefinitions.find(
    (candidate) => candidate.name === blueprintName,
  );

  if (builtin) {
    return { definition: builtin, synthetic: false };
  }

  const nodes = visitedNodes(visitRows);

  if (nodes.length === 0) {
    return { definition: null, synthetic: true };
  }

  return {
    definition: {
      name: blueprintName,
      description: "Inferred from the recorded walk; edges are not declared.",
      version: 1,
      entry: nodes[0].id,
      exit: nodes[nodes.length - 1].id,
      nodes,
      edges: chainEdges(nodes),
    },
    synthetic: true,
  };
}
