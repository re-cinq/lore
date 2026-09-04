// Counting properly-crossing edge segments in a resolved layout.

import type { Point } from "./graph-layout";

export interface CrossingEdge {
  source: string;
  target: string;
}

const orient = (a: Point, b: Point, c: Point): number =>
  (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);

interface CrossingSegment {
  s: string;
  t: string;
  a: Point;
  b: Point;
}

/** Count pairs of edges whose straight segments properly cross. */
function segmentsCross(A: CrossingSegment, B: CrossingSegment): boolean {
  const aTouchesB = A.s === B.s || A.s === B.t;
  const tTouchesB = A.t === B.s || A.t === B.t;

  if (aTouchesB || tTouchesB) {
    return false;
  }
  const d1 = orient(B.a, B.b, A.a);
  const d2 = orient(B.a, B.b, A.b);
  const d3 = orient(A.a, A.b, B.a);
  const d4 = orient(A.a, A.b, B.b);

  const aStraddlesB = d1 * d2 < 0;
  const bStraddlesA = d3 * d4 < 0;

  return aStraddlesB && bStraddlesA;
}

export function countCrossings(
  edges: CrossingEdge[],
  pos: Map<string, Point>,
): number {
  const segs = edges
    .map((e) => ({
      s: e.source,
      t: e.target,
      a: pos.get(e.source),
      b: pos.get(e.target),
    }))
    .filter((seg): seg is CrossingSegment => !!seg.a && !!seg.b);
  let crossings = 0;

  segs.forEach((first, i) => {
    for (let j = i + 1; j < segs.length; j += 1) {
      if (segmentsCross(first, segs[j])) {
        crossings += 1;
      }
    }
  });

  return crossings;
}
