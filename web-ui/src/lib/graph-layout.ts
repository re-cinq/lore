/**
 * Pure, deterministic placement helpers for the D3 spec-graph layout.
 *
 * The graph is seeded deterministically and then relaxed by gentle forces:
 *   1. split into connected components (union-find);
 *   2. the large components (>= threshold) form the core — each laid out
 *      degree-radially, the most-connected node at its centre and the least
 *      on the outside;
 *   3. the small components are tucked into the emptiest angular sectors of the
 *      outer margin, where they read as satellites.
 * The simulation then anchors each node to its seed (forceX/forceY) so the
 * structure holds while nodes stay fluid and draggable. These helpers are all
 * value-in/value-out; the imperative D3 setup consumes them. Siblings of the
 * other geometry modules (anchor-spacing, ring-exclusion, graph-crowding).
 */

const SETTLE_FLOOR = 120;
const SETTLE_CAP = 400;
const SETTLE_PER_NODE = 3;
// Golden angle — spreads same-radius nodes evenly without clumping.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SECTOR_BINS = 24;

export interface LayoutLink {
  source: string;
  target: string;
}

export interface SeedNode {
  id: string;
  degree: number;
}

export interface Point {
  x: number;
  y: number;
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

/** Lay a component out around `center`: highest-degree node at the centre,
 * lower-degree nodes on rings spreading outward (√-spaced for even density),
 * angled by the golden angle. Writes into `pos`. */
function placeDegreeRadial(
  comp: string[],
  degreeOf: Map<string, number>,
  center: Point,
  maxRadius: number,
  pos: Map<string, Point>,
): void {
  const ranked = [...comp].sort((a, b) => (degreeOf.get(b) ?? 0) - (degreeOf.get(a) ?? 0));
  const count = ranked.length;
  ranked.forEach((id, rank) => {
    const radius = count <= 1 ? 0 : maxRadius * Math.sqrt(rank / (count - 1));
    const angle = rank * GOLDEN_ANGLE;
    pos.set(id, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  });
}

/** Centre point for each core component: a single core owns the viewport centre;
 * multiple cores are spread on a ring so they don't overlap. */
function coreComponentCenters(coreCount: number, center: Point, boundR: number): Point[] {
  if (coreCount <= 1) return [{ x: center.x, y: center.y }];
  const ringR = boundR * 0.5;
  return Array.from({ length: coreCount }, (_, i) => {
    const angle = (2 * Math.PI * i) / coreCount;
    return { x: center.x + ringR * Math.cos(angle), y: center.y + ringR * Math.sin(angle) };
  });
}

/** Drop each small component as a cluster into the emptiest angular sector of the
 * outer margin, re-weighting occupancy so later clusters avoid earlier ones. */
function placeSmallComponents(small: string[][], pos: Map<string, Point>, center: Point, marginR: number): void {
  const occupancy = new Array<number>(SECTOR_BINS).fill(0);
  const binOf = (p: Point) => {
    const a = Math.atan2(p.y - center.y, p.x - center.x);
    return Math.floor(((a + Math.PI) / (2 * Math.PI)) * SECTOR_BINS) % SECTOR_BINS;
  };
  for (const p of pos.values()) occupancy[binOf(p)] += 1;

  for (const comp of [...small].sort((a, b) => b.length - a.length)) {
    let bin = 0;
    for (let i = 1; i < SECTOR_BINS; i += 1) if (occupancy[i] < occupancy[bin]) bin = i;
    const angle = -Math.PI + ((bin + 0.5) / SECTOR_BINS) * 2 * Math.PI;
    const cx = center.x + marginR * Math.cos(angle);
    const cy = center.y + marginR * Math.sin(angle);
    comp.forEach((id, i) => {
      const r = 14 * Math.sqrt(i);
      const a = i * GOLDEN_ANGLE;
      pos.set(id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    });
    occupancy[bin] += comp.length * 3;
  }
}

export interface SeedOptions {
  width: number;
  height: number;
  boundR: number;
  /** Components with fewer than this many nodes are satellites, not core. */
  smallThreshold?: number;
}

/**
 * Deterministic seed positions for the whole graph: large components form the
 * degree-radial core (most-connected at the centre), small components ring the
 * outer margin in the emptiest sectors. If no component reaches the threshold,
 * the single largest one is promoted to the core so the centre is never empty.
 */
export function seedPositions(
  nodes: SeedNode[],
  links: LayoutLink[],
  { width, height, boundR, smallThreshold = 10 }: SeedOptions,
): Map<string, Point> {
  const center = { x: width / 2, y: height / 2 };
  const degreeOf = new Map(nodes.map((n) => [n.id, n.degree]));
  const comps = connectedComponents(nodes.map((n) => n.id), links);

  let cores = comps.filter((c) => c.length >= smallThreshold).sort((a, b) => b.length - a.length);
  let satellites = comps.filter((c) => c.length < smallThreshold);
  if (cores.length === 0 && comps.length > 0) {
    const biggest = comps.reduce((a, b) => (b.length > a.length ? b : a));
    cores = [biggest];
    satellites = comps.filter((c) => c !== biggest);
  }

  const pos = new Map<string, Point>();
  const centers = coreComponentCenters(cores.length, center, boundR);
  const coreMaxRadius = cores.length <= 1 ? boundR * 0.62 : boundR * 0.3;
  cores.forEach((comp, i) => placeDegreeRadial(comp, degreeOf, centers[i], coreMaxRadius, pos));
  placeSmallComponents(satellites, pos, center, boundR * 0.82);

  for (const n of nodes) if (!pos.has(n.id)) pos.set(n.id, { x: center.x, y: center.y });
  return pos;
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
