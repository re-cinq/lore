/**
 * Pure viewport math for the canvas spec-graph layer.
 *
 * A canvas has no per-element DOM events, so hit-testing is done by hand: map the
 * pointer's screen coordinates back into world space through the d3.zoom
 * transform (`invertPoint`), then find the node under it (`findNodeAtPoint`).
 * `applyPoint` is the forward map, used to place SVG overlays (badges, labels)
 * over canvas-drawn nodes. Value-in/value-out — mirrors d3.zoomTransform without
 * a DOM dependency so it is unit-testable in the Node environment.
 */

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

/**
 * Returns the id of the node whose disc (radius + slop) contains `world`,
 * choosing the nearest centre when discs overlap. Null when the point is clear
 * of every node. Coordinates are in world space (invert the pointer first).
 */
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
