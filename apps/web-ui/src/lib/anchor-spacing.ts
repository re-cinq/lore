/** Pure anchor-spacing geometry for the D3 spec-graph view — treats each anchor as a zero-radius disc so spacing and ring clearance become the same keep-out problem (composes ring-exclusion's `Disc`). */
import { resolveExclusion, type Disc } from "./ring-exclusion";

/** An anchor node (Spec/ADR): an identity plus a position in layout coordinates. */
export type Anchor = { id: string; x: number; y: number };

/** Position for `self` at least `gap` from every other anchor (mapped to zero-radius discs) and outside every ring disc; `self` never repels itself. */
export function resolveSpacing(
  self: Anchor,
  anchors: Anchor[],
  rings: Disc[],
  gap: number,
): { x: number; y: number } {
  const anchorDiscs: Disc[] = anchors
    .filter((anchor) => anchor.id !== self.id)
    .map((anchor) => ({ x: anchor.x, y: anchor.y, r: 0 }));
  const keepOutDiscs = anchorDiscs.concat(rings);

  return resolveExclusion({ x: self.x, y: self.y }, keepOutDiscs, gap);
}
