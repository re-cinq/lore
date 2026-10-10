"use client";

// Renders a VisibleGraph — lays out the mode-selected nodes/connectors from graph-view-model and hands drawing to ./run-graph/*; every node also carries its status as text, so meaning never rests on color alone.
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import { layoutAssemblyLine } from "@/lib/dag-layout";
import { columnsFor } from "@/lib/dag-wrap";
import { typeFamilyOf } from "@/lib/node-type-family";
import type { VisibleGraph } from "@/lib/graph-view-model";
import ArrowMarkerDefs from "./run-graph/ArrowMarkerDefs";
import GraphEdge from "./run-graph/GraphEdge";
import GraphNode from "./run-graph/GraphNode";
import RunGraphLegend from "./run-graph/RunGraphLegend";
import { useElementWidth } from "./run-graph/use-element-width";
import {
  LAYER_GAP,
  NODE_WIDTH,
  VIEW_PADDING,
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
  /** The node the inspector shows, drawn with a ring. */
  selectedNodeId?: string | null;
  /** Run mode facts per node id (model · duration · visits); a node with none draws no line. */
  nodeMeta?: Readonly<Record<string, string>>;
  // Section heading; `null` renders none, for a caller that titles the section itself.
  heading?: string | null;
}

// The mode-selected workflow graph: drawn at its natural size and wrapped onto as many rows as the panel's width needs.
export default function RunGraphView(props: RunGraphViewProps) {
  const [panelRef, panelWidth] = useElementWidth<HTMLElement>();
  const { graph, heading = "Graph" } = props;

  if (graph.nodes.length === 0) {
    return <EmptyGraph />;
  }

  return (
    <section ref={panelRef} className={styles.panel}>
      {heading !== null && <h2 className={styles.heading}>{heading}</h2>}
      <div className={styles.scroll}>
        <GraphSvg {...graphSvgProps(props, panelWidth)} />
      </div>
      <RunGraphLegend families={familiesOf(graph)} />
    </section>
  );
}

/** Everything the drawing needs: the layout for this width, and the run's interaction and facts. */
function graphSvgProps(props: RunGraphViewProps, panelWidth: number | null) {
  const { graph, definition, nodeMeta } = props;

  return {
    laid: layoutRunGraph(graph, definition, {
      withMeta: hasMetaLine(graph, nodeMeta),
      columnsPerBand: columnsOf(panelWidth),
    }),
    mode: graph.mode,
    onSelectNode: props.onSelectNode,
    selectedNodeId: props.selectedNodeId,
    nodeMeta,
  };
}

/** Unmeasured (on the server, or before the first resize report), the line stays on one row. */
function columnsOf(panelWidth: number | null): number {
  return panelWidth === null
    ? Number.POSITIVE_INFINITY
    : columnsFor(panelWidth, {
        layerGap: LAYER_GAP,
        nodeWidth: NODE_WIDTH,
        padding: VIEW_PADDING,
      });
}

function familiesOf(graph: RunGraphViewProps["graph"]) {
  return new Set(
    graph.nodes.map((node) => typeFamilyOf(node.nodeType ?? node.type)),
  );
}

function EmptyGraph() {
  return (
    <p className={styles.empty}>No assembly-line graph to show for this run.</p>
  );
}

interface LaidGraphProps {
  laid: ReturnType<typeof layoutRunGraph>;
  mode: RunGraphViewProps["graph"]["mode"];
  onSelectNode: RunGraphViewProps["onSelectNode"];
  selectedNodeId: RunGraphViewProps["selectedNodeId"];
  nodeMeta: RunGraphViewProps["nodeMeta"];
}

/** The graph itself. A node nothing leaves is TERMINAL, which the plain label renders differently. `role="img"` with a `<title>`: the drawing is one picture to a screen reader, not a stack of unlabelled shapes, and the mode belongs in that label because the same nodes mean different things in definition and run mode. */
function GraphSvg(props: LaidGraphProps) {
  const { laid, mode } = props;
  const { layout, view, titleId, edgeByPair } = laid;

  return (
    <svg
      className={styles.svg}
      width={view.width}
      height={view.height}
      role="img"
      aria-labelledby={titleId}
      viewBox={view.viewBox}
    >
      <title id={titleId}>{`Workflow graph (${mode})`}</title>
      <ArrowMarkerDefs />

      <GraphEdges edges={layout.edges} edgeByPair={edgeByPair} />

      <GraphNodes {...props} />
    </svg>
  );
}

interface GraphEdgesProps {
  edges: ReturnType<typeof layoutAssemblyLine>["edges"];
  edgeByPair: Map<string, RunGraphViewProps["graph"]["edges"][number]>;
}

/** A laid-out edge carries only its geometry, so its tone and whether the run took it are looked up from the model by endpoint pair. An edge with no model draws neutral rather than disappearing — the shape of the definition is worth showing even where the run has not reached it. */
function GraphEdges({ edges, edgeByPair }: GraphEdgesProps) {
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
function GraphNodes(props: LaidGraphProps) {
  const { laid, mode, onSelectNode, selectedNodeId, nodeMeta } = props;
  const { nodes } = laid.layout;

  return nodes.map((node) => (
    <GraphNode
      key={node.id}
      node={node}
      model={laid.nodeById.get(node.id)}
      mode={mode}
      height={laid.nodeHeight}
      isTerminal={!laid.nodesWithOutgoing.has(node.id)}
      selected={node.id === selectedNodeId}
      meta={nodeMeta?.[node.id]}
      onSelect={onSelectNode}
    />
  ));
}

/** Everything geometric: where each node sits, how big the canvas has to be, plus the model lookups the drawing needs. */
function layoutRunGraph(
  graph: RunGraphViewProps["graph"],
  definition: RunGraphViewProps["definition"],
  { withMeta, columnsPerBand }: { withMeta: boolean; columnsPerBand: number },
) {
  const nodeHeight = nodeHeightFor(graph, { withMeta });
  const layout = layoutAssemblyLine(
    toLayoutDefinition(graph, definition),
    layoutOptions(nodeHeight, columnsPerBand),
  );

  return {
    layout,
    view: fitView(layout.contentBox),
    nodeHeight,
    titleId: `run-graph-title-${graph.mode}`,
    ...graphLookups(graph),
  };
}

/** The run graph's pitch: full-size nodes, the rows of a layer a node apart, and as many columns per band as the panel holds. */
function layoutOptions(nodeHeight: number, columnsPerBand: number) {
  return {
    layerGap: LAYER_GAP,
    nodeWidth: NODE_WIDTH,
    nodeHeight,
    rowGap: nodeHeight + 48,
    columnsPerBand,
  };
}

/** The lookups that let the drawing match a laid-out node or edge back to its model. A node with no outgoing edge is terminal, which is read from the EDGES rather than from the node, because a definition does not mark its own ends. */
function graphLookups(graph: RunGraphViewProps["graph"]) {
  const { nodes, edges } = graph;

  return {
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    edgeByPair: new Map(
      edges.map((edge) => [edgeMapKey(edge.from, edge.to), edge]),
    ),
    nodesWithOutgoing: new Set(edges.map((edge) => edge.from)),
  };
}

/** A facts line is drawn only in run mode, and only when some node has one to draw. */
function hasMetaLine(
  graph: RunGraphViewProps["graph"],
  nodeMeta: RunGraphViewProps["nodeMeta"],
): boolean {
  return (
    graph.mode === "run" &&
    graph.nodes.some((node) => (nodeMeta?.[node.id] ?? "") !== "")
  );
}
