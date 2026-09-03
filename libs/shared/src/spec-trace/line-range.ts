/** line-range — the closed-interval arithmetic every impact lookup shares, so coverage facets, chunk spans, and diff hunks compare via one "do these overlap" implementation. */

/** Two closed integer intervals overlap iff neither ends before the other begins. */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Inverse of ingest-coverage's `serializeRanges`: "5-10,20-25" → [[5,10],[20,25]]. */
export function parseRanges(facet: string): [number, number][] {
  const ranges: [number, number][] = [];

  for (const part of facet.split(",")) {
    const [rawStart, rawEnd, ...rest] = part.split("-");

    if (rest.length || !rawStart || !rawEnd) {
      continue;
    }
    const start = Number(rawStart);
    const end = Number(rawEnd);

    if (Number.isFinite(start) && Number.isFinite(end)) {
      ranges.push([start, end]);
    }
  }

  return ranges;
}
