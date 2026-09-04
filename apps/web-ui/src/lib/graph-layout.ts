// Pure, deterministic helpers for D3 spec-graph layout.

export {
  containedVelocity,
  type ContainmentOptions,
} from "./graph-layout-containment";
export { countCrossings, type CrossingEdge } from "./graph-layout-crossings";
export { radialTree, type RadialTreeOptions } from "./graph-layout-radial-tree";

const SETTLE_FLOOR = 120;
const SETTLE_CAP = 400;
const SETTLE_PER_NODE = 3;
// Golden angle — successive points get even angular coverage with no spokes.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface Point {
  x: number;
  y: number;
}

export interface LayoutLink {
  source: string;
  target: string;
}

/** Adds `id` as its own parent when the union-find map hasn't seen it yet. */
function ensureSelfParent(parent: Map<string, string>, id: string): void {
  if (!parent.has(id)) {
    parent.set(id, id);
  }
}

/** Path-compressing find/union pair sharing one parent map. */
function unionFind(parent: Map<string, string>) {
  const find = (node: string): string => {
    // Every node walked here was seeded into `parent` up front, so lookups never miss.
    let root = node;

    while (parent.get(root)! !== root) {
      root = parent.get(root)!;
    }
    let cur = node;

    while (cur !== root) {
      const next = parent.get(cur)!;

      parent.set(cur, root);
      cur = next;
    }

    return root;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  return { find, union };
}

/** Appends `id` to its root's group, creating the group on the first member. */
function pushToGroup(
  groups: Map<string, string[]>,
  root: string,
  id: string,
): void {
  const members = groups.get(root);

  if (members) {
    members.push(id);

    return;
  }
  groups.set(root, [id]);
}

/** Partition nodes into connected components via union-find. */
export function connectedComponents(
  nodeIds: string[],
  links: LayoutLink[],
): string[][] {
  const parent = new Map<string, string>();
  const { find, union } = unionFind(parent);

  for (const id of nodeIds) {
    ensureSelfParent(parent, id);
  }

  for (const { source, target } of links) {
    ensureSelfParent(parent, source);
    ensureSelfParent(parent, target);
    union(source, target);
  }

  const groups = new Map<string, string[]>();

  for (const id of nodeIds) {
    pushToGroup(groups, find(id), id);
  }

  return [...groups.values()];
}

/** Component spots on rim, evenly spaced by angle. */
export function rimTargets(
  components: string[][],
  center: Point,
  rimRadius: number,
): Map<string, Point> {
  const out = new Map<string, Point>();
  const n = Math.max(1, components.length);

  components.forEach((comp, i) => {
    const angle = (2 * Math.PI * i) / n;
    const target = {
      x: center.x + rimRadius * Math.cos(angle),
      y: center.y + rimRadius * Math.sin(angle),
    };

    for (const id of comp) {
      out.set(id, target);
    }
  });

  return out;
}

/** Feature nodes across sunflower spiral; area proportional to size. */
export function featureSeedPositions(
  features: { id: string; size: number }[],
  center: Point,
  maxRadius: number,
): Map<string, Point> {
  const out = new Map<string, Point>();
  const weights = features.map((f) => Math.max(1, f.size));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let running = 0;

  features.forEach((f, i) => {
    const frac = (running + weights[i] / 2) / total;

    running += weights[i];
    const radius = maxRadius * Math.sqrt(frac);
    const angle = i * GOLDEN_ANGLE;

    out.set(f.id, {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  });

  return out;
}

/** Headless pre-warm tick budget: ~3 per node, floored at 120 and capped at 400. */
export function settleTicks(nodeCount: number): number {
  return Math.min(
    SETTLE_CAP,
    Math.max(SETTLE_FLOOR, nodeCount * SETTLE_PER_NODE),
  );
}

export interface BoundingRadiusOptions {
  /** Pixels of radius per √element; the dominant area term. */
  spacing?: number;
  /** Smallest radius, so tiny graphs still get breathing room. */
  floor?: number;
  /** Largest radius, so a huge graph can't blow the bound off-screen. */
  cap?: number;
}

/** Radius of circle layout is kept inside; grows with √(vertices+edges). */
export function boundingRadius(
  vertexCount: number,
  edgeCount: number,
  { spacing = 28, floor = 220, cap = 1100 }: BoundingRadiusOptions = {},
): number {
  const raw = spacing * Math.sqrt(Math.max(0, vertexCount + edgeCount));

  return Math.min(cap, Math.max(floor, raw));
}

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
}

/** Radius of feature tree ring, scaled to prevent overlap. */
export function featureRingRadius(
  featureCount: number,
  treeRadius: number,
  minRadius: number,
): number {
  return Math.max(minRadius, (featureCount * 2.2 * treeRadius) / (2 * Math.PI));
}

/** Farthest non-small node from `center`, the anchor the small ones must clear. */
function maxRadiusExcluding(
  nodes: PlacedNode[],
  smallIds: Set<string>,
  center: Point,
): number {
  let mainRadius = 0;

  for (const node of nodes) {
    if (smallIds.has(node.id)) {
      continue;
    }
    mainRadius = Math.max(
      mainRadius,
      Math.hypot(node.x - center.x, node.y - center.y),
    );
  }

  return mainRadius;
}

/** Pushes every small node still inside `barrier` radially out to it. */
function pushPastBarrier(
  nodes: PlacedNode[],
  smallIds: Set<string>,
  center: Point,
  barrier: number,
): Map<string, Point> {
  const moved = new Map<string, Point>();

  for (const node of nodes) {
    if (!smallIds.has(node.id)) {
      continue;
    }
    const dx = node.x - center.x;
    const dy = node.y - center.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (dist >= barrier) {
      continue;
    }
    moved.set(node.id, {
      x: center.x + (barrier * dx) / dist,
      y: center.y + (barrier * dy) / dist,
    });
  }

  return moved;
}

export function separateSmallComponents(
  nodes: PlacedNode[],
  smallIds: Set<string>,
  center: Point,
  margin: number,
): Map<string, Point> {
  const barrier = maxRadiusExcluding(nodes, smallIds, center) + margin;

  return pushPastBarrier(nodes, smallIds, center, barrier);
}
