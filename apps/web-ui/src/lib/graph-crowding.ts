/**
 * Pure, deterministic anti-crowding rules for the D3 spec-graph force layout.
 *
 * The base graph hairballs when many nodes wire into a few hubs: leaves pile up
 * around the hub and labels overlap. These three degree-driven transforms spread
 * a dense neighbourhood apart without touching the expanded-ring spoke layout —
 * value-in/value-out, no side effects, so the layout calls them per node/link.
 *
 * `nodeDegrees` is computed once from the raw link list; the three rule helpers
 * take an already-resolved degree so the simulation's per-tick callbacks stay a
 * single arithmetic step. The degree cap keeps a single mega-hub from blowing
 * the layout off-screen.
 */

const DEGREE_CAP = 16;
const COLLIDE_BASE_PADDING = 18;
const LINK_STRENGTH_NUMERATOR = 0.7;
const LINK_STRENGTH_FLOOR = 0.04;

export interface DegreeLink {
  source: string;
  target: string;
}

/** Count how many links touch each node (both endpoints of every link). */
export function nodeDegrees(links: DegreeLink[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const { source, target } of links) {
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }
  return degree;
}

/**
 * Rule #1 — a link is weakened by its busier (higher-degree) endpoint, so a node
 * wired to 30 files no longer yanks all 30 into a knot. Isolated leaf-to-leaf
 * links stay strong; hub links sink to a floor so they never vanish entirely.
 */
export function crowdedLinkStrength(
  degreeSource: number,
  degreeTarget: number,
): number {
  const busier = Math.max(degreeSource, degreeTarget);
  return Math.max(LINK_STRENGTH_FLOOR, LINK_STRENGTH_NUMERATOR / busier);
}

/**
 * Rule #2 — repulsion grows with the square root of degree (capped), so hubs
 * actively shove their dense neighbourhoods apart.
 */
export function crowdedCharge(baseCharge: number, degree: number): number {
  return baseCharge * Math.sqrt(Math.min(degree, DEGREE_CAP));
}

/**
 * Rule #3 — hard personal space: the collision radius reserves the circle plus
 * base padding plus padding that grows with degree (capped), so busy nodes and
 * their labels physically cannot pile on top of each other.
 */
export function crowdedCollideRadius(
  baseRadius: number,
  degree: number,
): number {
  return baseRadius + COLLIDE_BASE_PADDING + Math.min(degree, DEGREE_CAP);
}
