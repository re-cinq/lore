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
    resolved = pushOutsideDisc(resolved, disc, margin);
  }

  return resolved;
}

/** Push one point out to a single disc's keep-out radius, or leave it alone. */
function pushOutsideDisc(
  point: { x: number; y: number },
  disc: Disc,
  margin: number,
): { x: number; y: number } {
  const keepOut = disc.r + margin;
  const dx = point.x - disc.x;
  const dy = point.y - disc.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance >= keepOut) {
    return point;
  }
  const [dirX, dirY] = distance === 0 ? [1, 0] : [dx, dy];
  const span = distance === 0 ? 1 : distance;

  return {
    x: disc.x + (keepOut * dirX) / span,
    y: disc.y + (keepOut * dirY) / span,
  };
}
