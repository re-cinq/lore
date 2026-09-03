// Which graph a run should draw: its stored clone (FR6.38) or synthesized chain from visit rows (for pre-clone runs).

import type {
  AssemblyLineDefinition,
  DefinitionEdge,
  DefinitionNode,
} from "./assembly-line-definition";
import type { AssemblyRunNode } from "./assembly-runs";
import type { RunGraph } from "./run-graph";

export interface RunGraphDefinition {
  definition: AssemblyLineDefinition | null;
  /** True when the graph was inferred from visit rows rather than declared. */
  synthetic: boolean;
}

/** Distinct visited node ids, in the order the walk first reached them. */
function visitedNodes(visitRows: readonly AssemblyRunNode[]): DefinitionNode[] {
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

/** Sequential always edges between visited nodes; prevents longest-path layering collapse into vertical pile. */
function chainEdges(nodes: readonly DefinitionNode[]): DefinitionEdge[] {
  return nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
    on: "always" as const,
  }));
}

/** Stored graph in view shape; fills description/version authoring metadata (omitted from clone to save space). */
function fromRunGraph(graph: RunGraph): AssemblyLineDefinition {
  return {
    name: graph.name,
    description: "",
    version: 1,
    entry: graph.entry,
    exit: graph.exit,
    nodes: graph.nodes.map((node) => ({
      ...node,
      // Safe: node.type from snapshotGraph (loader's node-type union); drift guard keeps unions aligned.
      type: node.type as DefinitionNode["type"],
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      on: edge.on as DefinitionEdge["on"],
    })),
  };
}

/** Graph to draw for a run: its own clone if present, otherwise chain synthesized from visit rows. */
export function definitionForRun(
  blueprintName: string,
  visitRows: readonly AssemblyRunNode[],
  graph?: RunGraph | null,
): RunGraphDefinition {
  if (graph) {
    return { definition: fromRunGraph(graph), synthetic: false };
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
