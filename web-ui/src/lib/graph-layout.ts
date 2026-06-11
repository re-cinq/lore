/**
 * Pure, deterministic placement helpers for the D3 spec-graph layout.
 *
 * The graph is arranged in concentric tiers by node type — Features pulled to
 * the centre, the spec scaffolding (Spec/Section/Statement/ADR) on a middle
 * ring, and the leaf artefacts (File/Test/Code) loose on the outer ring — and
 * kept inside a soft radius border so nothing flies off. These helpers compute
 * the tier targets, the border, and a headless pre-warm budget as value-in/
 * value-out functions; the imperative D3 force setup consumes them. Siblings of
 * the other geometry modules (anchor-spacing, ring-exclusion, graph-crowding).
 */
import type { SpecGraphNodeType } from './spec-graph';

const SETTLE_FLOOR = 120;
const SETTLE_CAP = 400;
const SETTLE_PER_NODE = 3;

// Concentric tiers as a fraction of the bounding radius, with how hard each tier
// is pulled toward its ring — the centre attracts firmly, the outer tier stays
// loose so leaves drift around the sides.
const TIER: Record<SpecGraphNodeType, { fraction: number; strength: number }> = {
  Feature: { fraction: 0, strength: 0.5 },
  Spec: { fraction: 0.36, strength: 0.28 },
  Section: { fraction: 0.36, strength: 0.28 },
  Statement: { fraction: 0.36, strength: 0.28 },
  ADR: { fraction: 0.36, strength: 0.28 },
  File: { fraction: 0.68, strength: 0.12 },
  TestChunk: { fraction: 0.68, strength: 0.12 },
  CodeChunk: { fraction: 0.68, strength: 0.12 },
};

/**
 * The radial target for a node type: the ring radius (as a fraction of the
 * bounding radius) it gravitates to, and how strongly. Drives a `forceRadial`
 * so the layout layers by type while every node stays fluid and draggable.
 */
export function radialTarget(type: SpecGraphNodeType, boundR: number): { radius: number; strength: number } {
  // The live projection can emit a type outside the declared union, so fall back
  // to the loose outer tier rather than throwing on an unknown type.
  const tier = TIER[type] ?? TIER.File;
  return { radius: tier.fraction * boundR, strength: tier.strength };
}

/**
 * Firm up a node's radial pull in proportion to its degree, ramping from the
 * tier's base strength (degree ≤ 1) to `max` (degree ≥ `cap`). High-degree hubs
 * get strong repulsion but weak links, so without this anchor they drift out to
 * the border; pulling well-connected nodes harder toward their ring keeps the
 * cloud compact.
 */
export function degreeAnchoredStrength(
  baseStrength: number,
  degree: number,
  { cap = 16, max = 0.9 }: { cap?: number; max?: number } = {},
): number {
  const factor = Math.min(1, Math.max(0, (degree - 1) / (cap - 1)));
  return baseStrength + (max - baseStrength) * factor;
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
  point: { x: number; y: number },
  velocity: { vx: number; vy: number },
  center: { x: number; y: number },
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
    // Cancel any outward component so the node cannot move further out.
    const outward = vx * ux + vy * uy;
    if (outward > 0) {
      vx -= outward * ux;
      vy -= outward * uy;
    }
    // Gentle, capped inward return so it eases home rather than snapping.
    const ret = Math.min(maxReturn, over * returnPull);
    vx -= ret * ux;
    vy -= ret * uy;
    // Slower the further out it is.
    const damp = 1 / (1 + over / dampScale);
    vx *= damp;
    vy *= damp;
  }

  if (Math.abs(vx) < epsilon) vx = 0;
  if (Math.abs(vy) < epsilon) vy = 0;
  return { vx, vy };
}
