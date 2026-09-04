/** Segment clipping for D3: parts outside ring discs; shared Disc definition with ring-exclusion. */

import type { Disc } from "./ring-exclusion";

export type { Disc };

/** A point in layout coordinates. */
export type Point = { x: number; y: number };

/** The point on segment a→b at parameter `t` (t=0 → a, t=1 → b). */
function pointAt(a: Point, b: Point, t: number): Point {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** Returns [enter, exit] parameter interval where segment is strictly inside disc, or null. */
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

function mergeIntervals(
  intervals: Array<[number, number]>,
): Array<[number, number]> {
  const merged: Array<[number, number]> = [intervals[0]];

  for (const [enter, exit] of intervals.slice(1)) {
    const last = merged[merged.length - 1];

    if (enter <= last[1]) {
      last[1] = Math.max(last[1], exit);
      continue;
    }
    merged.push([enter, exit]);
  }

  return merged;
}

function piecesOutside(
  a: Point,
  b: Point,
  merged: Array<[number, number]>,
): Array<{ a: Point; b: Point }> {
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

/** Parts of segment outside all discs: complement of merged inside-intervals within [0, 1]. */
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

  return piecesOutside(a, b, mergeIntervals(intervals));
}
