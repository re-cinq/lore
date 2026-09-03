/** Anti-crowding rules for D3 spec-graph force layout; three degree-driven transforms. */

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

/** Weaken link by busier endpoint so hubs don't yank neighbors into knot. */
export function crowdedLinkStrength(
  degreeSource: number,
  degreeTarget: number,
): number {
  const busier = Math.max(degreeSource, degreeTarget);

  return Math.max(LINK_STRENGTH_FLOOR, LINK_STRENGTH_NUMERATOR / busier);
}

/** Repulsion grows with degree so hubs shove dense neighbourhoods apart. */
export function crowdedCharge(baseCharge: number, degree: number): number {
  return baseCharge * Math.sqrt(Math.min(degree, DEGREE_CAP));
}

/** Hard personal space: collision radius grows with degree so labels cannot overlap. */
export function crowdedCollideRadius(
  baseRadius: number,
  degree: number,
): number {
  return baseRadius + COLLIDE_BASE_PADDING + Math.min(degree, DEGREE_CAP);
}
