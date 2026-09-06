// Pure geometry for the run graph (box height, viewBox, layout-shaped definition) — no React, no styles, only WHERE things sit.
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { Box } from "@/lib/dag-layout";
import type { VisibleGraph } from "@/lib/graph-view-model";

// Box width, sized to the longest badge the spec puts in one ("Waiting for the spec PR", FR6.23, at 176); the layout uses this same constant as column pitch.
export const NODE_WIDTH = 216;
// Vertical pitch of one outcome row inside a definition-mode node.
export const OUTCOME_ROW = 15;

// Where NodeRunBadge starts its text (right of the glyph) and the gap it leaves at the far edge.
const LABEL_LEFT_OFFSET = 40;
const LABEL_RIGHT_PADDING = 12;
// Average advance of the badge font in px — an average, not a measurement, since SVG text cannot reflow and per-glyph measuring needs a DOM round-trip.
const LABEL_CHAR_WIDTH = 6.8;

// How many characters of badge text fit inside one box, derived from NODE_WIDTH rather than hardcoded.
export const NODE_LABEL_CHARS = Math.floor(
  (NODE_WIDTH - LABEL_LEFT_OFFSET - LABEL_RIGHT_PADDING) / LABEL_CHAR_WIDTH,
);

// Backstop, not the mechanism — SVG text neither wraps nor clips itself, so an unforeseen label would draw over its neighbour; pair with a <title> for hover.
export function fitNodeLabel(text: string, max = NODE_LABEL_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const BASE_NODE_HEIGHT = 48;
const OUTCOME_TOP = 14;
const PADDING = 28;
const MIN_VIEW_WIDTH = 480;
const MIN_VIEW_HEIGHT = 200;

export interface FittedView {
  viewBox: string;
  width: number;
}

// A padded viewBox around the content, floored to a natural size.
export function fitView(box: Box): FittedView {
  const width = Math.max(box.maxX - box.minX + PADDING * 2, MIN_VIEW_WIDTH);
  const height = Math.max(box.maxY - box.minY + PADDING * 2, MIN_VIEW_HEIGHT);
  const cy = (box.minY + box.maxY) / 2;

  return {
    viewBox: `${box.minX - PADDING} ${cy - height / 2} ${width} ${height}`,
    width,
  };
}

// Uniform node height: taller in definition mode so a source node's outcome list fits; run/bare definition nodes stay the base height.
export function nodeHeightFor(graph: VisibleGraph): number {
  if (graph.mode !== "definition") {
    return BASE_NODE_HEIGHT;
  }

  const rows = Math.max(0, ...graph.nodes.map((node) => node.outcomes.length));

  return rows > 0
    ? BASE_NODE_HEIGHT + OUTCOME_TOP + rows * OUTCOME_ROW
    : BASE_NODE_HEIGHT;
}

function resolveEntry(
  definition: AssemblyLineDefinition | null,
  graph: VisibleGraph,
): string {
  return definition?.entry ?? graph.nodes.at(0)?.id ?? "";
}

// A layout-shaped definition from the visible graph; connectors carry no condition (structure only).
export function toLayoutDefinition(
  graph: VisibleGraph,
  definition: AssemblyLineDefinition | null,
): AssemblyLineDefinition {
  return {
    name: definition?.name ?? "workflow",
    description: "",
    version: 1,
    entry: resolveEntry(definition, graph),
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

// The one key shape for an edge, shared by the model lookup and the `data-edge` attribute tests query, so the two can never drift apart.
export function edgeMapKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
