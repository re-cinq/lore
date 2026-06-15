/**
 * Pure, deterministic helpers for the D3 spec-graph layout.
 *
 * The graph is a plain force-directed cloud — connected nodes cluster on their
 * own, no node type or degree is mapped to a fixed region. These helpers only
 * keep it tidy: a headless pre-warm budget, a size-based radius the cloud is
 * kept inside, and the velocity correction that enforces that border. All
 * value-in/value-out; the imperative D3 setup consumes them. Siblings of the
 * other geometry modules (anchor-spacing, ring-exclusion, graph-crowding).
 */

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
 * Give each (small) component its own spot on a rim of `rimRadius` around
 * `center`, evenly spaced by angle so the components sit apart instead of
 * clumping on one ring. Every node of a component maps to that component's spot;
 * charge then spreads the component's own members locally around it.
 */
export function rimTargets(components: string[][], center: Point, rimRadius: number): Map<string, Point> {
  const out = new Map<string, Point>();
  const n = Math.max(1, components.length);
  components.forEach((comp, i) => {
    const angle = (2 * Math.PI * i) / n;
    const target = { x: center.x + rimRadius * Math.cos(angle), y: center.y + rimRadius * Math.sin(angle) };
    for (const id of comp) out.set(id, target);
  });
  return out;
}

/**
 * Seed Feature nodes across a sunflower spiral (even angular coverage) with each
 * Feature claiming area proportional to its `size`, so larger Features land
 * further out and end up more distanced from their neighbours. Returns a target
 * per feature id; the layout seeds fresh positions from these.
 */
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
    out.set(f.id, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  });
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
 * size (vertices + edges), then clamped to [floor, cap].
 */
export function boundingRadius(
  vertexCount: number,
  edgeCount: number,
  { spacing = 28, floor = 220, cap = 1100 }: BoundingRadiusOptions = {},
): number {
  const raw = spacing * Math.sqrt(Math.max(0, vertexCount + edgeCount));
  return Math.min(cap, Math.max(floor, raw));
}

export interface ContainmentOptions {
  /** Inward return speed per pixel of overshoot, capped at `maxReturn`. */
  returnPull?: number;
  /** Ceiling on the inward return speed, so a far node eases in, not snaps. */
  maxReturn?: number;
  /** Overshoot at which velocity is roughly halved — the "slower the further" knob. */
  dampScale?: number;
  /** Velocities with smaller magnitude than this are flattened to 0. */
  epsilon?: number;
}

/**
 * Replace a node's velocity with one that keeps it inside the radius border. A
 * node past `radius` has its outward velocity component cancelled (so it can't
 * integrate any further out), is eased back by a capped inward pull, and has its
 * remaining speed damped more the further it has strayed ("slower the further").
 * Runs at full strength every tick (not alpha-scaled) so containment doesn't fade
 * as the simulation cools. Denormal-tiny components are flattened to 0.
 */
export function containedVelocity(
  point: Point,
  velocity: { vx: number; vy: number },
  center: Point,
  radius: number,
  { returnPull = 0.1, maxReturn = 6, dampScale = 300, epsilon = 1e-3 }: ContainmentOptions = {},
): { vx: number; vy: number } {
  let vx = velocity.vx;
  let vy = velocity.vy;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dist = Math.hypot(dx, dy);

  if (dist > radius && dist > 0) {
    const ux = dx / dist;
    const uy = dy / dist;
    const over = dist - radius;
    const outward = vx * ux + vy * uy;
    if (outward > 0) {
      vx -= outward * ux;
      vy -= outward * uy;
    }
    const ret = Math.min(maxReturn, over * returnPull);
    vx -= ret * ux;
    vy -= ret * uy;
    const damp = 1 / (1 + over / dampScale);
    vx *= damp;
    vy *= damp;
  }

  if (Math.abs(vx) < epsilon) vx = 0;
  if (Math.abs(vy) < epsilon) vy = 0;
  return { vx, vy };
}
