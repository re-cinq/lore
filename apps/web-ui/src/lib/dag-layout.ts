// Deterministic layered layout for assembly-line definition graphs.

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
  /** Tight bounds of everything drawn. */
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

/** Cyclic edges found by DFS; back-edges and self-loops excluded. */
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

/** Whether this edge advances the layout. A back-edge would make every node in its cycle claim an ever-deeper layer; an edge naming an undeclared node would have the layout invent one. */
function isForwardEdge(
  edge: DefinitionEdge,
  cyclic: Set<DefinitionEdge>,
  declared: Set<string>,
): boolean {
  return !cyclic.has(edge) && declared.has(edge.from) && declared.has(edge.to);
}

/** The definition with its back-edges removed, indexed for a topological walk. Back-edges are dropped rather than followed: a retry loop points at a node the walk has already placed, and honouring it would make every node in the cycle claim a layer deeper than the last, forever. Edges naming an undeclared node go too — a definition can reference a node it does not define, and a layout must not invent one. */
function forwardGraph(def: AssemblyLineDefinition) {
  const cyclic = cyclicEdges(def);
  const declared = new Set(def.nodes.map((node) => node.id));
  const layers: Record<string, number> = {};
  const indegree: Record<string, number> = {};

  for (const node of def.nodes) {
    layers[node.id] = 0;
    indegree[node.id] = 0;
  }
  const acyclicOut = new Map<string, DefinitionEdge[]>();

  for (const edge of def.edges) {
    if (!isForwardEdge(edge, cyclic, declared)) {
      continue;
    }
    indegree[edge.to] += 1;
    acyclicOut.set(edge.from, [...(acyclicOut.get(edge.from) ?? []), edge]);
  }

  return { layers, indegree, acyclicOut };
}

/** Layer index per node: longest acyclic path from source. */
export function layerByLongestPath(
  def: AssemblyLineDefinition,
): Map<string, number> {
  const { layers, indegree, acyclicOut } = forwardGraph(def);
  const queue = def.nodes
    .map((node) => node.id)
    .filter((id) => indegree[id] === 0);

  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];

    acyclicOut.get(id)?.forEach((edge) => {
      layers[edge.to] = Math.max(layers[edge.to], layers[id] + 1);
      indegree[edge.to] -= 1;

      if (indegree[edge.to] === 0) {
        queue.push(edge.to);
      }
    });
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

/** One node per row within its layer, in declaration order. Deterministic by construction — no sorting and no crossing minimization — because a layout that reshuffles between renders makes a live run look like it changed when only the renderer did. */
function placeNodes(
  def: AssemblyLineDefinition,
  layers: Map<string, number>,
  opts: ResolvedOptions,
): LayoutNode[] {
  const rowsUsed = new Map<number, number>();

  return def.nodes.map((node) => {
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
}

/** Positions, SVG path data for definition; forward/back/self-loop edges. */
export function layoutAssemblyLine(
  def: AssemblyLineDefinition,
  options: LayoutOptions = {},
): GraphLayout {
  const opts = { ...DEFAULTS, ...options };
  const layers = layerByLongestPath(def);
  const nodes = placeNodes(def, layers, opts);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Back-edges arc BELOW everything, so the floor has to clear the lowest node plus the arc's own drop.
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

/** Coordinate pairs in path d; bounding them bounds the arc. */
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
    pointsOf(edge.d).forEach((point) => {
      xs.push(point.x);
      ys.push(point.y);
    });
  }

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
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
    return selfLoop(from, { halfW, halfH, arcDrop: opts.arcDrop });
  }

  if (edge.kind === "back") {
    return backArc(from, to, halfH, floor);
  }

  return forwardCurve(from, to, halfW, opts.layerGap / 3);
}
