/**
 * Pure, deterministic ring-exclusion geometry for the D3 spec-graph view.
 * Keeps non-ring nodes outside the open "ring" discs: any node that falls
 * within a disc's keep-out radius (r + margin) is pushed radially out along
 * the center→point direction to sit exactly on that radius. Value-in/value-out,
 * no side effects — the layout calls it per node every tick.
 */

/** An exclusion disc: center (x, y) and radius r, in layout coordinates. */
export type Disc = { x: number; y: number; r: number };

/**
 * Pushes `point` out of every disc it intrudes on, to that disc's keep-out
 * radius (r + margin), preserving the center→point direction. A point already
 * clear of a disc is left untouched by that disc.
 */
export function resolveExclusion(
  point: { x: number; y: number },
  discs: Disc[],
  margin: number,
): { x: number; y: number } {
  let resolved = point;

  for (const disc of discs) {
    const keepOut = disc.r + margin;
    const dx = resolved.x - disc.x;
    const dy = resolved.y - disc.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < keepOut) {
      const [dirX, dirY] = distance === 0 ? [1, 0] : [dx, dy];
      const span = distance === 0 ? 1 : distance;

      resolved = {
        x: disc.x + (keepOut * dirX) / span,
        y: disc.y + (keepOut * dirY) / span,
      };
    }
  }

  return resolved;
}
