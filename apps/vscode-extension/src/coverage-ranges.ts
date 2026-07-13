/**
 * Parse the `Coverage.covers|ranges` edge facet the spec graph carries on a
 * File node — a comma-separated list of covered line intervals like
 * `"12-18,30-40"` (a bare number is a one-line interval). Pure; the only
 * structured line data the remote graph exposes for the coverage layer.
 */

export interface LineInterval {
  startLine: number;
  endLine: number;
}

export function parseRangesFacet(
  facet: string | undefined | null,
): LineInterval[] {
  if (!facet) return [];
  const intervals: LineInterval[] = [];
  for (const segment of facet.split(",")) {
    const [rawStart, rawEnd] = segment.split("-");
    const startLine = Number(rawStart?.trim());
    if (!Number.isFinite(startLine)) continue;
    const endLine = rawEnd === undefined ? startLine : Number(rawEnd.trim());
    intervals.push({
      startLine,
      endLine: Number.isFinite(endLine) ? endLine : startLine,
    });
  }
  return intervals;
}
