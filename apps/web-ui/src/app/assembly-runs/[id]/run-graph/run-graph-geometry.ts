// Pure geometry for the run graph: how tall a node box is, how big the viewBox
// around the drawn content is, and the layout-shaped definition the DAG layout
// consumes. No React, no styles — the parts that decide WHERE things sit, kept
// apart from the parts that draw them.

import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { Box } from "@/lib/dag-layout";
import type { VisibleGraph } from "@/lib/graph-view-model";

export const NODE_WIDTH = 176;
/** Vertical pitch of one outcome row inside a definition-mode node. */
export const OUTCOME_ROW = 15;

const BASE_NODE_HEIGHT = 48;
const OUTCOME_TOP = 14;
const PADDING = 28;
const MIN_VIEW_WIDTH = 480;
const MIN_VIEW_HEIGHT = 200;

export interface FittedView {
  viewBox: string;
  width: number;
}

/** A padded viewBox around the content, floored to a natural size. */
export function fitView(box: Box): FittedView {
  const width = Math.max(box.maxX - box.minX + PADDING * 2, MIN_VIEW_WIDTH);
  const height = Math.max(box.maxY - box.minY + PADDING * 2, MIN_VIEW_HEIGHT);
  const cy = (box.minY + box.maxY) / 2;

  return {
    viewBox: `${box.minX - PADDING} ${cy - height / 2} ${width} ${height}`,
    width,
  };
}

/** Uniform node height: taller in definition mode so a source node's outcome list
 *  fits inside its box. Run and bare definition nodes stay the base height. */
export function nodeHeightFor(graph: VisibleGraph): number {
  if (graph.mode !== "definition") {
    return BASE_NODE_HEIGHT;
  }

  const rows = Math.max(0, ...graph.nodes.map((node) => node.outcomes.length));

  return rows > 0
    ? BASE_NODE_HEIGHT + OUTCOME_TOP + rows * OUTCOME_ROW
    : BASE_NODE_HEIGHT;
}

/** A layout-shaped definition from the visible graph; connectors carry no
 *  condition (structure only). */
export function toLayoutDefinition(
  graph: VisibleGraph,
  definition: AssemblyLineDefinition | null,
): AssemblyLineDefinition {
  return {
    name: definition?.name ?? "workflow",
    description: "",
    version: 1,
    entry: definition?.entry ?? graph.nodes[0]?.id ?? "",
    exit: definition?.exit ?? "",
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
    })) as AssemblyLineDefinition["nodes"],
    edges: graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      on: "always" as const,
    })),
  };
}

/** The one key shape for an edge, shared by the model lookup and the `data-edge`
 *  attribute the tests query — so the two can never drift apart. */
export function edgeMapKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
