// Pure viewport math for canvas spec-graph layer; hand-based hit-testing.

export interface ZoomTransform {
  x: number;
  y: number;
  k: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A node reduced to what hit-testing needs: a position and a pick radius. */
export interface HitNode {
  id: string;
  x: number;
  y: number;
  r: number;
}

/** Screen → world: undo the zoom translate then scale. */
export function invertPoint(transform: ZoomTransform, screen: Point): Point {
  return {
    x: (screen.x - transform.x) / transform.k,
    y: (screen.y - transform.y) / transform.k,
  };
}

/** World → screen: scale then translate. */
export function applyPoint(transform: ZoomTransform, world: Point): Point {
  return {
    x: world.x * transform.k + transform.x,
    y: world.y * transform.k + transform.y,
  };
}

/** Node id whose disc contains world; nearest center if overlapping. */
export function findNodeAtPoint(
  world: Point,
  nodes: HitNode[],
  slop = 0,
): string | null {
  let bestId: string | null = null;
  let bestDistance = Infinity;

  for (const node of nodes) {
    const dx = world.x - node.x;
    const dy = world.y - node.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= node.r + slop && distance < bestDistance) {
      bestDistance = distance;
      bestId = node.id;
    }
  }

  return bestId;
}
