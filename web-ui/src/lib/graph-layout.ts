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
  Spec: { fraction: 0.42, strength: 0.28 },
  Section: { fraction: 0.42, strength: 0.28 },
  Statement: { fraction: 0.42, strength: 0.28 },
  ADR: { fraction: 0.42, strength: 0.28 },
  File: { fraction: 0.85, strength: 0.12 },
  TestChunk: { fraction: 0.85, strength: 0.12 },
  CodeChunk: { fraction: 0.85, strength: 0.12 },
};

/**
 * The radial target for a node type: the ring radius (as a fraction of the
 * bounding radius) it gravitates to, and how strongly. Drives a `forceRadial`
 * so the layout layers by type while every node stays fluid and draggable.
 */
export function radialTarget(type: SpecGraphNodeType, boundR: number): { radius: number; strength: number } {
  const tier = TIER[type];
  return { radius: tier.fraction * boundR, strength: tier.strength };
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

/**
 * Soft radius border: the velocity nudge that pulls a point back toward `center`
 * when it strays past `radius`. The pull grows with the overshoot (a one-sided
 * spring), so nodes can poke past the border but are eased back rather than
 * snapped to it — no hard wall. Zero inside the radius. The caller scales the
 * result by the simulation's alpha and adds it to the node's velocity.
 */
export function radialContainmentDelta(
  point: { x: number; y: number },
  center: { x: number; y: number },
  radius: number,
  strength: number,
): { dvx: number; dvy: number } {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= radius || dist === 0) return { dvx: 0, dvy: 0 };
  const k = (strength * (dist - radius)) / dist;
  return { dvx: -dx * k, dvy: -dy * k };
}
