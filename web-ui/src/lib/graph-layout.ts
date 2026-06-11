/**
 * Pure, deterministic placement helpers for the D3 spec-graph initial layout.
 *
 * The graph is laid out as a "cloud" of connected components: the big core sits
 * in the centre and small satellite clusters ring the outside. These helpers
 * compute that arrangement (and a headless pre-warm budget) as value-in/value-out
 * functions; the imperative D3 force setup consumes them. Siblings of the other
 * geometry modules (anchor-spacing, ring-exclusion, graph-crowding).
 */

const SETTLE_FLOOR = 120;
const SETTLE_CAP = 400;
const SETTLE_PER_NODE = 3;

export interface LayoutLink {
  source: string;
  target: string;
}

export interface ComponentCentersOptions {
  width: number;
  height: number;
  /** Components with fewer than this many nodes are treated as small. */
  smallThreshold?: number;
  /** Radius of the ring small components are spread around. */
  edgeRadius: number;
}

/**
 * Partition the node set into connected components (union-find over the links).
 * Nodes that appear in no link come back as their own singleton component.
 */
export function connectedComponents(nodeIds: string[], links: LayoutLink[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  for (const id of nodeIds) if (!parent.has(id)) parent.set(id, id);
  for (const { source, target } of links) {
    if (!parent.has(source)) parent.set(source, source);
    if (!parent.has(target)) parent.set(target, target);
    union(source, target);
  }

  const groups = new Map<string, string[]>();
  for (const id of nodeIds) {
    const root = find(id);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(id);
  }
  return [...groups.values()];
}

/**
 * Assign each node a target centre for the initial layout: nodes of a large
 * component (size >= `smallThreshold`) target the viewport centre; small
 * components are spread at even angles around a ring of `edgeRadius`.
 */
export function assignComponentCenters(
  components: string[][],
  { width, height, smallThreshold = 10, edgeRadius }: ComponentCentersOptions,
): Map<string, { x: number; y: number }> {
  const center = { x: width / 2, y: height / 2 };
  const smallCount = components.filter((c) => c.length < smallThreshold).length;
  const out = new Map<string, { x: number; y: number }>();

  let smallIndex = 0;
  for (const comp of components) {
    let target: { x: number; y: number };
    if (comp.length >= smallThreshold) {
      target = { x: center.x, y: center.y };
    } else {
      const angle = (2 * Math.PI * smallIndex) / smallCount;
      target = { x: center.x + edgeRadius * Math.cos(angle), y: center.y + edgeRadius * Math.sin(angle) };
      smallIndex += 1;
    }
    for (const id of comp) out.set(id, target);
  }
  return out;
}

/** Headless pre-warm tick budget: ~3 per node, floored at 120 and capped at 400. */
export function settleTicks(nodeCount: number): number {
  return Math.min(SETTLE_CAP, Math.max(SETTLE_FLOOR, nodeCount * SETTLE_PER_NODE));
}

export interface BoundingRadiusOptions {
  /** Pixels of radius per √element; the dominant area term. */
  spacing?: number;
  /** Smallest radius, so tiny graphs still get breathing room. */
  floor?: number;
  /** Largest radius, so a huge graph can't blow the bound off-screen. */
  cap?: number;
}

/**
 * The radius of the circle the whole layout is kept inside — the "radius border"
 * that stops nodes flying off. Grows with the square root of the graph's total
 * size (vertices + edges), since the area needed to pack the cloud scales with
 * element count, then clamped to [floor, cap].
 */
export function boundingRadius(
  vertexCount: number,
  edgeCount: number,
  { spacing = 40, floor = 260, cap = 1600 }: BoundingRadiusOptions = {},
): number {
  const raw = spacing * Math.sqrt(Math.max(0, vertexCount + edgeCount));
  return Math.min(cap, Math.max(floor, raw));
}

/** Clamp a point to within `radius` of `center`, projecting it radially inward
 * if it strays outside. Points already inside are returned unchanged. */
export function clampToRadius(
  point: { x: number; y: number },
  center: { x: number; y: number },
  radius: number,
): { x: number; y: number } {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= radius || dist === 0) return { x: point.x, y: point.y };
  const k = radius / dist;
  return { x: center.x + dx * k, y: center.y + dy * k };
}
