// Parses the "12-18,30-40" Coverage.covers|ranges facet; a bare number is a one-line interval.

export interface LineInterval {
  startLine: number;
  endLine: number;
}

function parseInterval(segment: string): LineInterval | undefined {
  const parts = segment.split("-");
  const startLine = Number(parts[0].trim());

  if (!Number.isFinite(startLine)) {
    return undefined;
  }
  const rawEnd = parts.at(1);
  const endLine = rawEnd === undefined ? startLine : Number(rawEnd.trim());

  return { startLine, endLine: Number.isFinite(endLine) ? endLine : startLine };
}

export function parseRangesFacet(
  facet: string | undefined | null,
): LineInterval[] {
  if (!facet) {
    return [];
  }

  return facet
    .split(",")
    .map(parseInterval)
    .filter((interval): interval is LineInterval => interval !== undefined);
}
