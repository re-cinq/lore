// Deterministic layered layout for assembly-line definition graphs. Zero
// dependencies by design: the graphs are at most a handful of nodes, so a
// longest-path layering plus fixed-pitch placement beats pulling dagre or d3
// into the bundle for the same result.

import type {
  AssemblyLineDefinition,
  DefinitionEdge,
} from "./assembly-line-definition";

export type EdgeKind = "forward" | "back" | "self";

export type ClassifiedEdge = DefinitionEdge & { kind: EdgeKind };

export interface LayoutNode {
  id: string;
  layer: number;
  row: number;
  x: number;
  y: number;
}

export interface LayoutEdge extends ClassifiedEdge {
  d: string;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /**
   * Tight bounds of everything drawn — node boxes and edge arcs. The view fits
   * its viewBox to this so a one-node graph sits in a small frame instead of
   * floating in a canvas sized for the whole layer grid.
   */
  contentBox: Box;
}

export interface LayoutOptions {
  layerGap?: number;
  rowGap?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  originX?: number;
  originY?: number;
  arcDrop?: number;
}

type ResolvedOptions = Required<LayoutOptions>;

const DEFAULTS: ResolvedOptions = {
  layerGap: 240, // a 132px node box plus 108px of connector air per column; shrinking it crowds the edge paths
  rowGap: 96,
  nodeWidth: 132,
  nodeHeight: 48,
  originX: 90,
  originY: 60,
  arcDrop: 56,
};

/**
 * Edges that would make the graph cyclic, found by a DFS from `entry` in
 * declaration order: an edge into a node still on the stack is a back edge, and
 * an edge onto its own source is a self-loop. Both are excluded from layering.
 */
function cyclicEdges(def: AssemblyLineDefinition): Set<DefinitionEdge> {
  const cyclic = new Set<DefinitionEdge>();
  const onStack = new Set<string>();
  const done = new Set<string>();
  const outgoing = new Map<string, DefinitionEdge[]>();

  for (const edge of def.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  const visit = (id: string): void => {
    onStack.add(id);

    for (const edge of outgoing.get(id) ?? []) {
      if (edge.to === edge.from || onStack.has(edge.to)) {
        cyclic.add(edge);
        continue;
      }

      if (!done.has(edge.to)) {
        visit(edge.to);
      }
    }

    onStack.delete(id);
    done.add(id);
  };

  visit(def.entry);

  for (const node of def.nodes) {
    if (!done.has(node.id)) {
      visit(node.id);
    }
  }

  return cyclic;
}

/**
 * Layer index per node: the longest acyclic path from a source, so a node sits
 * one column right of its latest predecessor. Back-edges and self-loops are
 * ignored, which is what keeps a retry loop from pushing its target rightwards.
 */
export function layerByLongestPath(
  def: AssemblyLineDefinition,
): Map<string, number> {
  const cyclic = cyclicEdges(def);
  const declared = new Set(def.nodes.map((node) => node.id));
  const acyclic = def.edges.filter(
    (edge) =>
      !cyclic.has(edge) && declared.has(edge.from) && declared.has(edge.to),
  );
  const layers: Record<string, number> = {};
  const indegree: Record<string, number> = {};

  for (const node of def.nodes) {
    layers[node.id] = 0;
    indegree[node.id] = 0;
  }

  const acyclicOut = new Map<string, DefinitionEdge[]>();

  for (const edge of acyclic) {
    indegree[edge.to] += 1;
    acyclicOut.set(edge.from, [...(acyclicOut.get(edge.from) ?? []), edge]);
  }

  const queue = def.nodes
    .map((node) => node.id)
    .filter((id) => indegree[id] === 0);

  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];

    for (const edge of acyclicOut.get(id) ?? []) {
      layers[edge.to] = Math.max(layers[edge.to], layers[id] + 1);
      indegree[edge.to] -= 1;

      if (indegree[edge.to] === 0) {
        queue.push(edge.to);
      }
    }
  }

  return new Map(Object.entries(layers));
}

/** Layer of a node, defaulting undeclared edge endpoints to the entry column. */
function layerOf(layers: Map<string, number>, id: string): number {
  return layers.get(id) ?? 0;
}

/** Tag each definition edge by how it travels across the layering. */
export function classifyEdges(
  def: AssemblyLineDefinition,
  layers: Map<string, number>,
): ClassifiedEdge[] {
  return def.edges.map((edge) => ({
    ...edge,
    kind: edgeKind(edge, layers),
  }));
}

function edgeKind(edge: DefinitionEdge, layers: Map<string, number>): EdgeKind {
  if (edge.from === edge.to) {
    return "self";
  }

  return layerOf(layers, edge.to) > layerOf(layers, edge.from)
    ? "forward"
    : "back";
}

/**
 * Positions and SVG path data for one definition. Forward edges run between
 * facing ports, back edges arc under the whole row so they read as returns
 * rather than as another forward hop, and a self-loop arcs over its own node so
 * it is visible instead of collapsing to a zero-length line.
 */
export function layoutAssemblyLine(
  def: AssemblyLineDefinition,
  options: LayoutOptions = {},
): GraphLayout {
  const opts = { ...DEFAULTS, ...options };
  const layers = layerByLongestPath(def);
  const rowsUsed = new Map<number, number>();

  const nodes: LayoutNode[] = def.nodes.map((node) => {
    const layer = layerOf(layers, node.id);
    const row = rowsUsed.get(layer) ?? 0;

    rowsUsed.set(layer, row + 1);

    return {
      id: node.id,
      layer,
      row,
      x: opts.originX + layer * opts.layerGap,
      y: opts.originY + row * opts.rowGap,
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const floor =
    Math.max(...nodes.map((node) => node.y)) +
    opts.nodeHeight / 2 +
    opts.arcDrop;

  const edges: LayoutEdge[] = classifyEdges(def, layers).map((edge) => ({
    ...edge,
    d: pathFor(edge, byId, opts, floor),
  }));

  return {
    nodes,
    edges,
    width:
      opts.originX +
      Math.max(...nodes.map((n) => n.layer)) * opts.layerGap +
      opts.nodeWidth,
    height: floor + opts.arcDrop,
    contentBox: contentBoxOf(nodes, edges, opts),
  };
}

/** Every coordinate pair in a path's `d` — the curve stays within the hull of
 *  these, so bounding by them bounds the arc. */
function pointsOf(d: string): { x: number; y: number }[] {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }

  return points;
}

function contentBoxOf(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: ResolvedOptions,
): Box {
  const halfW = opts.nodeWidth / 2;
  const halfH = opts.nodeHeight / 2;
  const xs: number[] = [];
  const ys: number[] = [];

  for (const node of nodes) {
    xs.push(node.x - halfW, node.x + halfW);
    ys.push(node.y - halfH, node.y + halfH);
  }

  for (const edge of edges) {
    for (const point of pointsOf(edge.d)) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function pathFor(
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

  const halfW = opts.nodeWidth / 2;
  const halfH = opts.nodeHeight / 2;

  if (edge.kind === "self") {
    const top = from.y - halfH;

    return [
      `M ${from.x} ${top}`,
      `C ${from.x - halfW} ${top - opts.arcDrop}`,
      `${from.x + halfW} ${top - opts.arcDrop}`,
      `${from.x + halfW} ${from.y}`,
    ].join(" ");
  }

  if (edge.kind === "back") {
    return [
      `M ${from.x} ${from.y + halfH}`,
      `C ${from.x} ${floor}`,
      `${to.x} ${floor}`,
      `${to.x} ${to.y + halfH}`,
    ].join(" ");
  }

  const bend = opts.layerGap / 3;

  return [
    `M ${from.x + halfW} ${from.y}`,
    `C ${from.x + halfW + bend} ${from.y}`,
    `${to.x - halfW - bend} ${to.y}`,
    `${to.x - halfW} ${to.y}`,
  ].join(" ");
}
