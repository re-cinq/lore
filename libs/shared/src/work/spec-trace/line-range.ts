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

/** Parses one "5-10" part into a range, or `undefined` when it isn't exactly two finite numbers. */
function parseRangePart(part: string): [number, number] | undefined {
  const [rawStart, rawEnd, ...rest] = part.split("-");

  if (rest.length || !rawStart || !rawEnd) {
    return undefined;
  }
  const start = Number(rawStart);
  const end = Number(rawEnd);

  return Number.isFinite(start) && Number.isFinite(end)
    ? [start, end]
    : undefined;
}

/** Inverse of ingest-coverage's `serializeRanges`: "5-10,20-25" → [[5,10],[20,25]]. */
export function parseRanges(facet: string): [number, number][] {
  const ranges: [number, number][] = [];

  for (const part of facet.split(",")) {
    const range = parseRangePart(part);

    if (range) {
      ranges.push(range);
    }
  }

  return ranges;
}
