/**
 * Pure, deterministic segment-vs-disc clipping for the D3 spec-graph view.
 * `visibleSegments` returns the parts of a segment a→b that lie outside the
 * open "ring" discs, so the layout draws edges only where they are not hidden
 * behind a disc. Value-in/value-out, no side effects — the layout calls it per
 * edge per tick. Discs share their definition with ring-exclusion, the sibling
 * geometry module, so `Disc` has one source of truth.
 */

import type { Disc } from "./ring-exclusion";

export type { Disc };

/** A point in layout coordinates. */
export type Point = { x: number; y: number };

/** The point on segment a→b at parameter `t` (t=0 → a, t=1 → b). */
function pointAt(a: Point, b: Point, t: number): Point {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/**
 * The `[enter, exit]` sub-interval of segment a→b (in parameter space, clamped
 * to [0, 1]) that lies strictly inside `disc`, or null when the segment never
 * crosses into the disc. Solves the parametric quadratic
 * `|a + t·(b−a) − center|² = r²`; the boundary is exclusive (a grazing
 * tangent — discriminant ≤ 0 — counts as outside). Multiply-before-divide and
 * root ordering are kept exact so endpoints land on precise coordinates.
 */
function insideInterval(
  a: Point,
  b: Point,
  disc: Disc,
): [number, number] | null {
  const dirX = b.x - a.x;
  const dirY = b.y - a.y;
  const offsetX = a.x - disc.x;
  const offsetY = a.y - disc.y;

  const quadA = dirX * dirX + dirY * dirY;
  const quadB = 2 * (offsetX * dirX + offsetY * dirY);
  const quadC = offsetX * offsetX + offsetY * offsetY - disc.r * disc.r;

  const discriminant = quadB * quadB - 4 * quadA * quadC;

  if (discriminant <= 0) {
    return null;
  }

  const root = Math.sqrt(discriminant);
  const enter = Math.max(0, (-quadB - root) / (2 * quadA));
  const exit = Math.min(1, (-quadB + root) / (2 * quadA));

  if (enter >= exit) {
    return null;
  }

  return [enter, exit];
}

/**
 * The parts of segment a→b that lie outside every disc.
 *
 * - No discs → the whole segment.
 * - Both endpoints inside a disc → `[]`.
 * - One endpoint inside → the single boundary→outside piece.
 *
 * The hidden inside-intervals are merged into a disjoint union and the visible
 * pieces are its complement within [0, 1], so a segment crossing several discs
 * yields one piece per gap between them.
 */
export function visibleSegments(
  a: Point,
  b: Point,
  discs: Disc[],
): Array<{ a: Point; b: Point }> {
  const intervals = discs
    .map((disc) => insideInterval(a, b, disc))
    .filter((interval): interval is [number, number] => interval !== null)
    .sort((left, right) => left[0] - right[0]);

  if (intervals.length === 0) {
    return [{ a, b }];
  }

  const merged: Array<[number, number]> = [intervals[0]];

  for (const [enter, exit] of intervals.slice(1)) {
    const last = merged[merged.length - 1];

    if (enter <= last[1]) {
      last[1] = Math.max(last[1], exit);
      continue;
    }
    merged.push([enter, exit]);
  }

  const pieces: Array<{ a: Point; b: Point }> = [];
  let cursor = 0;

  for (const [enter, exit] of merged) {
    if (cursor < enter) {
      pieces.push({ a: pointAt(a, b, cursor), b: pointAt(a, b, enter) });
    }
    cursor = exit;
  }

  if (cursor < 1) {
    pieces.push({ a: pointAt(a, b, cursor), b: pointAt(a, b, 1) });
  }

  return pieces;
}
