"use client";

// Renders a VisibleGraph — lays out the mode-selected nodes/connectors from graph-view-model and hands drawing to ./run-graph/*; every node also carries its status as text, so meaning never rests on color alone.
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import { layoutAssemblyLine } from "@/lib/dag-layout";
import type { VisibleGraph } from "@/lib/graph-view-model";
import ArrowMarkerDefs from "./run-graph/ArrowMarkerDefs";
import GraphEdge from "./run-graph/GraphEdge";
import GraphNode from "./run-graph/GraphNode";
import {
  NODE_WIDTH,
  edgeMapKey,
  fitView,
  nodeHeightFor,
  toLayoutDefinition,
} from "./run-graph/run-graph-geometry";
import styles from "./run-graph/run-graph.module.css";

export interface RunGraphViewProps {
  graph: VisibleGraph;
  /** Source definition — supplies layout entry/exit and the graph name. */
  definition: AssemblyLineDefinition | null;
  onSelectNode?: (nodeId: string) => void;
  // Section heading; `null` renders none, for a caller that titles the section itself.
  heading?: string | null;
}

// The mode-selected workflow graph. Pure render of a VisibleGraph.
/** Everything geometric: where each node sits, how big the canvas has to be, and the lookups that let the drawing match a laid-out node back to its model. A node with no outgoing edge is terminal, which is read from the EDGES rather than from the node, because a definition does not mark its own ends. */
function layoutRunGraph(
  graph: RunGraphViewProps["graph"],
  definition: RunGraphViewProps["definition"],
) {
  const nodeHeight = nodeHeightFor(graph);
  const layout = layoutAssemblyLine(toLayoutDefinition(graph, definition), {
    nodeWidth: NODE_WIDTH,
    nodeHeight,
    rowGap: nodeHeight + 48,
  });
  const view = fitView(layout.contentBox);
  const titleId = `run-graph-title-${graph.mode}`;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeByPair = new Map(
    graph.edges.map((edge) => [edgeMapKey(edge.from, edge.to), edge]),
  );
  const nodesWithOutgoing = new Set(graph.edges.map((edge) => edge.from));

  return {
    layout,
    view,
    nodeHeight,
    titleId,
    nodeById,
    edgeByPair,
    nodesWithOutgoing,
  };
}

/** A laid-out edge carries only its geometry, so its tone and whether the run took it are looked up from the model by endpoint pair. An edge with no model draws neutral rather than disappearing — the shape of the definition is worth showing even where the run has not reached it. */
function GraphEdges({
  edges,
  edgeByPair,
}: {
  edges: ReturnType<typeof layoutAssemblyLine>["edges"];
  edgeByPair: Map<string, RunGraphViewProps["graph"]["edges"][number]>;
}) {
  return (
    <>
      {edges.map((edge) => {
        const model = edgeByPair.get(edgeMapKey(edge.from, edge.to));

        return (
          <GraphEdge
            key={edgeMapKey(edge.from, edge.to)}
            edge={edge}
            tone={model?.tone ?? "neutral"}
            taken={model?.taken}
          />
        );
      })}
    </>
  );
}

/** Every node in the layout. A node nothing leaves is TERMINAL, which the plain label renders differently — the end of a line should read as an end rather than as a step still waiting for a successor. */
function GraphNodes({
  laid,
  mode,
  onSelectNode,
}: {
  laid: ReturnType<typeof layoutRunGraph>;
  mode: RunGraphViewProps["graph"]["mode"];
  onSelectNode: RunGraphViewProps["onSelectNode"];
}) {
  const { nodes } = laid.layout;

  return nodes.map((node) => (
    <GraphNode
      key={node.id}
      node={node}
      model={laid.nodeById.get(node.id)}
      mode={mode}
      height={laid.nodeHeight}
      isTerminal={!laid.nodesWithOutgoing.has(node.id)}
      onSelect={onSelectNode}
    />
  ));
}

/** The graph itself. A node nothing leaves is TERMINAL, which the plain label renders differently. `role="img"` with a `<title>`: the drawing is one picture to a screen reader, not a stack of unlabelled shapes, and the mode belongs in that label because the same nodes mean different things in definition and run mode. */
function GraphSvg({
  laid,
  mode,
  onSelectNode,
}: {
  laid: ReturnType<typeof layoutRunGraph>;
  mode: RunGraphViewProps["graph"]["mode"];
  onSelectNode: RunGraphViewProps["onSelectNode"];
}) {
  const { layout, view, titleId, edgeByPair } = laid;

  return (
    <svg
      className={styles.svg}
      style={{ ["--graph-width" as string]: `${view.width}px` }}
      role="img"
      aria-labelledby={titleId}
      viewBox={view.viewBox}
    >
      <title id={titleId}>{`Workflow graph (${mode})`}</title>
      <ArrowMarkerDefs />

      <GraphEdges edges={layout.edges} edgeByPair={edgeByPair} />

      <GraphNodes laid={laid} mode={mode} onSelectNode={onSelectNode} />
    </svg>
  );
}

export default function RunGraphView({
  graph,
  definition,
  onSelectNode,
  heading = "Graph",
}: RunGraphViewProps) {
  if (graph.nodes.length === 0) {
    return (
      <p className={styles.empty}>
        No assembly-line graph to show for this run.
      </p>
    );
  }

  return (
    <section className={styles.panel}>
      {heading !== null && <h2 className={styles.heading}>{heading}</h2>}
      <GraphSvg
        laid={layoutRunGraph(graph, definition)}
        mode={graph.mode}
        onSelectNode={onSelectNode}
      />
    </section>
  );
}
