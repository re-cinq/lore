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

  return (
    <section className={styles.panel}>
      {heading !== null && <h2 className={styles.heading}>{heading}</h2>}
      <svg
        className={styles.svg}
        style={{ ["--graph-width" as string]: `${view.width}px` }}
        role="img"
        aria-labelledby={titleId}
        viewBox={view.viewBox}
      >
        <title id={titleId}>{`Workflow graph (${graph.mode})`}</title>
        <ArrowMarkerDefs />

        {layout.edges.map((edge) => {
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

        {layout.nodes.map((node) => (
          <GraphNode
            key={node.id}
            node={node}
            model={nodeById.get(node.id)}
            mode={graph.mode}
            height={nodeHeight}
            isTerminal={!nodesWithOutgoing.has(node.id)}
            onSelect={onSelectNode}
          />
        ))}
      </svg>
    </section>
  );
}
