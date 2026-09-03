// Pure, deterministic helpers for D3 spec-graph layout.

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

/** Partition nodes into connected components via union-find. */
export function connectedComponents(
  nodeIds: string[],
  links: LayoutLink[],
): string[][] {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = node;

    while ((parent.get(root) ?? root) !== root) {
      root = parent.get(root) ?? root;
    }
    let cur = node;

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

  for (const id of nodeIds) {
    if (!parent.has(id)) {
      parent.set(id, id);
    }
  }

  for (const { source, target } of links) {
    if (!parent.has(source)) {
      parent.set(source, source);
    }

    if (!parent.has(target)) {
      parent.set(target, target);
    }
    union(source, target);
  }

  const groups = new Map<string, string[]>();

  for (const id of nodeIds) {
    const root = find(id);

    (groups.get(root) ?? groups.set(root, []).get(root)!).push(id);
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

/** Overshoot correction: cancel outward, ease back in with capped pull. */
function containOverflowVelocity(
  velocity: { vx: number; vy: number },
  unit: { ux: number; uy: number },
  over: number,
  knobs: { returnPull: number; maxReturn: number; dampScale: number },
): { vx: number; vy: number } {
  let vx = velocity.vx;
  let vy = velocity.vy;
  const outward = vx * unit.ux + vy * unit.uy;

  if (outward > 0) {
    vx -= outward * unit.ux;
    vy -= outward * unit.uy;
  }
  const ret = Math.min(knobs.maxReturn, over * knobs.returnPull);

  vx -= ret * unit.ux;
  vy -= ret * unit.uy;
  const damp = 1 / (1 + over / knobs.dampScale);

  return { vx: vx * damp, vy: vy * damp };
}

/** Keep node velocity inside radius border; damp speed by overshoot. */
export function containedVelocity(
  point: Point,
  velocity: { vx: number; vy: number },
  { center, radius }: { center: Point; radius: number },
  {
    returnPull = 0.1,
    maxReturn = 6,
    dampScale = 300,
    epsilon = 1e-3,
  }: ContainmentOptions = {},
): { vx: number; vy: number } {
  let vx = velocity.vx;
  let vy = velocity.vy;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dist = Math.hypot(dx, dy);

  if (dist > radius && dist > 0) {
    const contained = containOverflowVelocity(
      { vx, vy },
      { ux: dx / dist, uy: dy / dist },
      dist - radius,
      { returnPull, maxReturn, dampScale },
    );

    vx = contained.vx;
    vy = contained.vy;
  }

  if (Math.abs(vx) < epsilon) {
    vx = 0;
  }

  if (Math.abs(vy) < epsilon) {
    vy = 0;
  }

  return { vx, vy };
}

export interface RadialTreeOptions {
  center: Point;
  /** Radius added per hierarchy level — depth 0 (root) sits at the centre. */
  ringGap: number;
  /** Angular wedge the tree fills (defaults to a full circle). */
  angleStart?: number;
  angleEnd?: number;
}

/** Radial-tree seed positions; depth→radius, leaves spread evenly. */
export function radialTree(
  root: string,
  childrenOf: Map<string, string[]>,
  opts: RadialTreeOptions,
): Map<string, Point> {
  const { center, ringGap } = opts;
  const angleStart = opts.angleStart ?? 0;
  const angleEnd = opts.angleEnd ?? Math.PI * 2;

  const depth = new Map<string, number>();
  const postOrder: string[] = [];
  const leaves: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string, d: number) => {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    depth.set(id, d);
    const children = (childrenOf.get(id) ?? []).filter(
      (child) => !visited.has(child),
    );

    if (children.length === 0) {
      leaves.push(id);
    }

    for (const child of children) {
      visit(child, d + 1);
    }
    postOrder.push(id);
  };

  visit(root, 0);

  const span = angleEnd - angleStart;
  const leafCount = Math.max(leaves.length, 1);
  const angle = new Map<string, number>();

  leaves.forEach((id, i) =>
    angle.set(id, angleStart + (span * (i + 0.5)) / leafCount),
  );

  // Children precede parents in post-order, so a parent's children angles are set.
  for (const id of postOrder) {
    if (angle.has(id)) {
      continue;
    }
    const children = childrenOf.get(id) ?? [];
    const sum = children.reduce(
      (acc, child) => acc + (angle.get(child) ?? 0),
      0,
    );

    angle.set(id, children.length ? sum / children.length : angleStart);
  }

  const positions = new Map<string, Point>();

  for (const [id, d] of depth) {
    const a = angle.get(id) ?? angleStart;
    const r = d * ringGap;

    positions.set(id, {
      x: center.x + r * Math.cos(a),
      y: center.y + r * Math.sin(a),
    });
  }

  return positions;
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

export interface CrossingEdge {
  source: string;
  target: string;
}

const orient = (a: Point, b: Point, c: Point): number =>
  (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);

/** Count pairs of edges whose straight segments properly cross. */
interface CrossingSegment {
  s: string;
  t: string;
  a: Point;
  b: Point;
}

function segmentsCross(A: CrossingSegment, B: CrossingSegment): boolean {
  const aTouchesB = A.s === B.s || A.s === B.t;
  const tTouchesB = A.t === B.s || A.t === B.t;

  if (aTouchesB || tTouchesB) {
    return false;
  }
  const d1 = orient(B.a, B.b, A.a);
  const d2 = orient(B.a, B.b, A.b);
  const d3 = orient(A.a, A.b, B.a);
  const d4 = orient(A.a, A.b, B.b);

  const aStraddlesB = d1 * d2 < 0;
  const bStraddlesA = d3 * d4 < 0;

  return aStraddlesB && bStraddlesA;
}

export function countCrossings(
  edges: CrossingEdge[],
  pos: Map<string, Point>,
): number {
  const segs = edges
    .map((e) => ({
      s: e.source,
      t: e.target,
      a: pos.get(e.source),
      b: pos.get(e.target),
    }))
    .filter((seg): seg is CrossingSegment => !!seg.a && !!seg.b);
  let crossings = 0;

  segs.forEach((first, i) => {
    for (let j = i + 1; j < segs.length; j += 1) {
      if (segmentsCross(first, segs[j])) {
        crossings += 1;
      }
    }
  });

  return crossings;
}

export function separateSmallComponents(
  nodes: PlacedNode[],
  smallIds: Set<string>,
  center: Point,
  margin: number,
): Map<string, Point> {
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
  const barrier = mainRadius + margin;
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
