/**
 * Pure, deterministic anchor-spacing geometry for the D3 spec-graph view.
 * `resolveSpacing` keeps one "anchor" node (a Spec or ADR) at least `gap` away
 * from every other anchor and `gap` outside every ring disc. It does this by
 * composing the unit-tested ring-exclusion geometry: an anchor is treated as a
 * zero-radius disc, so spacing against anchors and clearance around rings become
 * the same keep-out problem. Value-in/value-out, no side effects — the layout
 * calls it per anchor per tick. Discs share their definition with ring-exclusion,
 * the sibling geometry module, so `Disc` has one source of truth.
 */

import { resolveExclusion, type Disc } from "./ring-exclusion";

/** An anchor node (Spec/ADR): an identity plus a position in layout coordinates. */
export type Anchor = { id: string; x: number; y: number };

/**
 * The position for `self` that sits at least `gap` from every other anchor and
 * `gap` outside every ring disc. Anchors other than `self` (matched by id) are
 * mapped to zero-radius keep-out discs and concatenated with `rings`, then
 * `resolveExclusion` pushes `self` clear of all of them. An anchor sharing
 * `self`'s id is excluded, so `self` never repels itself.
 */
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
