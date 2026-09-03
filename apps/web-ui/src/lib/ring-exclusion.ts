/** Pure ring-exclusion geometry for D3 spec-graph; keeps non-ring nodes outside discs via radial push; deterministic, no side effects. */

/** An exclusion disc: center (x, y) and radius r, in layout coordinates. */
export type Disc = { x: number; y: number; r: number };

/** Push point out of disc intrusions to keep-out radius, preserving center→point direction. */
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
