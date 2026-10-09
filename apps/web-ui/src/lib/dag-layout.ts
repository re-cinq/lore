// Deterministic layered layout for assembly-line definition graphs.

import type {
  AssemblyLineDefinition,
  DefinitionEdge,
} from "./assembly-line-definition";
import { contentBoxOf, pathFor } from "./dag-layout-paths";
import { wrapLayer } from "./dag-wrap";

export type EdgeKind = "forward" | "back" | "self";

export type ClassifiedEdge = DefinitionEdge & { kind: EdgeKind };

export interface LayoutNode {
  id: string;
  layer: number;
  /** Which band (row of columns) the node's layer wrapped onto; 0 when the line is not wrapped. */
  band: number;
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
  /** Columns per band before the line wraps onto the next band; unbounded keeps it on one. */
  columnsPerBand?: number;
}

export type ResolvedOptions = Required<LayoutOptions>;

const DEFAULTS: ResolvedOptions = {
  layerGap: 240, // a 132px node box plus 108px of connector air per column; shrinking it crowds the edge paths
  rowGap: 96,
  nodeWidth: 132,
  nodeHeight: 48,
  originX: 90,
  originY: 60,
  arcDrop: 56,
  columnsPerBand: Number.POSITIVE_INFINITY,
};

/** Positions, SVG path data for definition; forward/back/self-loop edges. */
export function layoutAssemblyLine(
  def: AssemblyLineDefinition,
  options: LayoutOptions = {},
): GraphLayout {
  const opts = { ...DEFAULTS, ...options };
  const layers = layerByLongestPath(def);
  const nodes = placeNodes(def, layers, opts);
  const floors = bandFloors(nodes, opts);
  const edges = layoutEdges({ def, layers, nodes, opts, floors });

  return {
    nodes,
    edges,
    width: layoutWidth(nodes, opts),
    height: (floors.at(-1) ?? opts.originY) + opts.arcDrop,
    contentBox: contentBoxOf(nodes, edges, opts),
  };
}

/** Layer index per node: longest acyclic path from source. */
export function layerByLongestPath(
  def: AssemblyLineDefinition,
): Map<string, number> {
  const { layers, indegree, acyclicOut } = forwardGraph(def);
  const nodeIds = def.nodes.map((node) => node.id);
  const queue = nodeIds.filter((id) => indegree[id] === 0);

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

/** Cyclic edges found by DFS; back-edges and self-loops excluded. */
function cyclicEdges(def: AssemblyLineDefinition): Set<DefinitionEdge> {
  const outgoing = new Map<string, DefinitionEdge[]>();

  for (const edge of def.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  const walk: CycleWalk = {
    outgoing,
    cyclic: new Set<DefinitionEdge>(),
    onStack: new Set<string>(),
    done: new Set<string>(),
  };

  visitForCycles(def.entry, walk);

  for (const node of def.nodes) {
    if (!walk.done.has(node.id)) {
      visitForCycles(node.id, walk);
    }
  }

  return walk.cyclic;
}

/** The bookkeeping one depth-first cycle hunt threads through its recursion. */
interface CycleWalk {
  outgoing: Map<string, DefinitionEdge[]>;
  cyclic: Set<DefinitionEdge>;
  onStack: Set<string>;
  done: Set<string>;
}

/** Descend from one node, recording every edge that closes back onto the stack. */
function visitForCycles(id: string, walk: CycleWalk): void {
  const { onStack, done, cyclic, outgoing } = walk;

  onStack.add(id);

  for (const edge of outgoing.get(id) ?? []) {
    if (edge.to === edge.from || onStack.has(edge.to)) {
      cyclic.add(edge);
      continue;
    }

    if (!done.has(edge.to)) {
      visitForCycles(edge.to, walk);
    }
  }

  onStack.delete(id);
  done.add(id);
}

/** Whether this edge advances the layout. A back-edge would make every node in its cycle claim an ever-deeper layer; an edge naming an undeclared node would have the layout invent one. */
function isForwardEdge(
  edge: DefinitionEdge,
  cyclic: Set<DefinitionEdge>,
  declared: Set<string>,
): boolean {
  return !cyclic.has(edge) && declared.has(edge.from) && declared.has(edge.to);
}

/** One node per row within its layer, in declaration order. Deterministic by construction — no sorting and no crossing minimization — because a layout that reshuffles between renders makes a live run look like it changed when only the renderer did. A wrapped line restarts its columns on each band, and a band sits below the one before it with room for that band's arcs. */
function placeNodes(
  def: AssemblyLineDefinition,
  layers: Map<string, number>,
  opts: ResolvedOptions,
): LayoutNode[] {
  const slots = slotNodes(def, layers, opts);
  const tops = bandTops(slots, opts);

  return slots.map((slot) => ({
    id: slot.id,
    layer: slot.layer,
    band: slot.band,
    row: slot.row,
    x: opts.originX + slot.column * opts.layerGap,
    y: tops[slot.band] + slot.row * opts.rowGap,
  }));
}

interface NodeSlot {
  id: string;
  layer: number;
  band: number;
  column: number;
  row: number;
}

/** Each node's layer, band, column and row within its layer, before anything is measured. */
function slotNodes(
  def: AssemblyLineDefinition,
  layers: Map<string, number>,
  opts: ResolvedOptions,
): NodeSlot[] {
  const rowsUsed = new Map<number, number>();

  return def.nodes.map((node) => {
    const layer = layerOf(layers, node.id);
    const row = rowsUsed.get(layer) ?? 0;

    rowsUsed.set(layer, row + 1);

    return {
      id: node.id,
      layer,
      row,
      ...wrapLayer(layer, opts.columnsPerBand),
    };
  });
}

/** The centre y of each band's first row: a band starts below the previous band's lowest node, its arc floor, and the same air again for the arrows that wrap down to it. */
function bandTops(slots: NodeSlot[], opts: ResolvedOptions): number[] {
  const bandCount = Math.max(...slots.map((slot) => slot.band)) + 1;
  const rowsPerBand = Array.from({ length: bandCount }, (_unused, band) =>
    Math.max(1, ...slots.filter((s) => s.band === band).map((s) => s.row + 1)),
  );
  const pitch = opts.nodeHeight + opts.arcDrop * 2;

  return rowsPerBand.reduce<number[]>(
    (tops, rows, band) =>
      band === 0
        ? [opts.originY]
        : [
            ...tops,
            tops[band - 1] + (rowsPerBand[band - 1] - 1) * opts.rowGap + pitch,
          ],
    [],
  );
}

/** Each band's floor: back-edges and wrapping arrows pass below that band's lowest node, by the arc's own drop. */
function bandFloors(nodes: LayoutNode[], opts: ResolvedOptions): number[] {
  const bandCount = Math.max(...nodes.map((node) => node.band)) + 1;

  return Array.from({ length: bandCount }, (_unused, band) => {
    const ys = nodes.filter((node) => node.band === band).map((n) => n.y);

    return Math.max(...ys) + opts.nodeHeight / 2 + opts.arcDrop;
  });
}

/** Right edge of the widest band, node box included. */
function layoutWidth(nodes: LayoutNode[], opts: ResolvedOptions): number {
  const columns = nodes.map(
    (node) => wrapLayer(node.layer, opts.columnsPerBand).column,
  );

  return opts.originX + Math.max(...columns) * opts.layerGap + opts.nodeWidth;
}

interface EdgeLayoutInput {
  def: AssemblyLineDefinition;
  layers: Map<string, number>;
  nodes: LayoutNode[];
  opts: ResolvedOptions;
  floors: number[];
}

/** Every classified edge with its drawn path resolved against the placed nodes. */
function layoutEdges(input: EdgeLayoutInput): LayoutEdge[] {
  const { def, layers, nodes, opts, floors } = input;
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return classifyEdges(def, layers).map((edge) => ({
    ...edge,
    d: pathFor(edge, byId, opts, floors),
  }));
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

/** Layer of a node, defaulting undeclared edge endpoints to the entry column. */
function layerOf(layers: Map<string, number>, id: string): number {
  return layers.get(id) ?? 0;
}
