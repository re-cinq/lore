// Which graph a run should draw, resolved without IO.
//
// The run CARRIES its graph (FR6.38): a clone of the blueprint, stamped at start,
// which is what makes a run drawable years later and immune to a blueprint edited
// or renamed since. That replaced a hand-transcribed catalog of the builtin YAMLs
// — 350 lines that could only ever describe the CURRENT blueprint, never the one a
// given run actually walked.
//
// Rows stamped before clones existed carry none, and no backfill is possible: the
// blueprint a historical run used is not recoverable from the row. Those fall back
// to a chain synthesized from the walk's own visit rows — the nodes are real, the
// edges are a presentational guess, and `synthetic` is how the caller knows to
// suppress edge labels rather than show a condition nobody asserted.

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

/** The stored graph, in the shape the view draws. `description` and `version` are
 *  authoring metadata the clone deliberately omits — a run needs the route, not the
 *  prose — so they are filled here rather than persisted per run. */
function fromRunGraph(graph: RunGraph): AssemblyLineDefinition {
  return {
    name: graph.name,
    description: "",
    version: 1,
    entry: graph.entry,
    exit: graph.exit,
    nodes: graph.nodes.map((node) => ({
      ...node,
      // Safe: node.type comes from snapshotGraph, which sources from the
      // loader's node-type union — every value in a stored graph is a member of
      // DefinitionNode["type"]. The drift guard keeps the unions aligned.
      type: node.type as DefinitionNode["type"],
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      on: edge.on as DefinitionEdge["on"],
    })),
  };
}

/**
 * The graph to draw for a run: its own clone when it has one, otherwise a chain
 * synthesized from the visit rows. A run with neither has no graph to draw at all.
 */
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
