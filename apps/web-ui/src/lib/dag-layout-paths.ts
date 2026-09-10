// SVG path data and content bounds for a laid-out assembly-line graph.

import type {
  Box,
  ClassifiedEdge,
  EdgeKind,
  LayoutEdge,
  LayoutNode,
  ResolvedOptions,
} from "./dag-layout";

/** Tight bounds of every node box plus every edge arc. */
export function contentBoxOf(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: ResolvedOptions,
): Box {
  const corners = nodeCorners(nodes, opts);
  const arcs = edges.flatMap((edge) => pointsOf(edge.d));
  const xs = [...corners.xs, ...arcs.map((point) => point.x)];
  const ys = [...corners.ys, ...arcs.map((point) => point.y)];

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** SVG path data for one edge, or "" when either endpoint was never placed. */
export function pathFor(
  edge: ClassifiedEdge,
  byId: Map<string, LayoutNode>,
  opts: ResolvedOptions,
  floor: number,
): string {
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);

  if (!from || !to) {
    return "";
  }

  return edgePath(edge.kind, { from, to, floor }, opts);
}

/** Self-loops arc over the top, back-edges pass under the floor, the rest curve forward. */
function edgePath(
  kind: EdgeKind,
  { from, to, floor }: { from: LayoutNode; to: LayoutNode; floor: number },
  opts: ResolvedOptions,
): string {
  const halfW = opts.nodeWidth / 2;
  const halfH = opts.nodeHeight / 2;

  if (kind === "self") {
    return selfLoop(from, { halfW, halfH, arcDrop: opts.arcDrop });
  }

  if (kind === "back") {
    return backArc(from, to, halfH, floor);
  }

  return forwardCurve(from, to, halfW, opts.layerGap / 3);
}

/** Both corners of every node box, as separate x and y lists. */
function nodeCorners(
  nodes: LayoutNode[],
  opts: ResolvedOptions,
): { xs: number[]; ys: number[] } {
  const halfW = opts.nodeWidth / 2;
  const halfH = opts.nodeHeight / 2;
  const xs: number[] = [];
  const ys: number[] = [];

  for (const node of nodes) {
    xs.push(node.x - halfW, node.x + halfW);
    ys.push(node.y - halfH, node.y + halfH);
  }

  return { xs, ys };
}

/** Coordinate pairs in path d; bounding them bounds the arc. */
function pointsOf(d: string): { x: number; y: number }[] {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }

  return points;
}

/** A node's edge back to itself, looping over the TOP — the only direction with guaranteed clearance, since rows below it may be occupied. */
function selfLoop(
  from: LayoutNode,
  { halfW, halfH, arcDrop }: { halfW: number; halfH: number; arcDrop: number },
): string {
  const top = from.y - halfH;

  return [
    `M ${from.x} ${top}`,
    `C ${from.x - halfW} ${top - arcDrop}`,
    `${from.x + halfW} ${top - arcDrop}`,
    `${from.x + halfW} ${from.y}`,
  ].join(" ");
}

/** A retry edge, dropped to the shared floor so it passes UNDER every node instead of cutting back through the layers it is returning across. */
function backArc(
  from: LayoutNode,
  to: LayoutNode,
  halfH: number,
  floor: number,
): string {
  return [
    `M ${from.x} ${from.y + halfH}`,
    `C ${from.x} ${floor}`,
    `${to.x} ${floor}`,
    `${to.x} ${to.y + halfH}`,
  ].join(" ");
}

/** The ordinary left-to-right edge. The bend is a third of the layer gap, which keeps the curve inside the connector air between columns. */
function forwardCurve(
  from: LayoutNode,
  to: LayoutNode,
  halfW: number,
  bend: number,
): string {
  return [
    `M ${from.x + halfW} ${from.y}`,
    `C ${from.x + halfW + bend} ${from.y}`,
    `${to.x - halfW - bend} ${to.y}`,
    `${to.x - halfW} ${to.y}`,
  ].join(" ");
}
