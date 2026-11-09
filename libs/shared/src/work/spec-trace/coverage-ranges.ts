/** How a coverage record's covered ranges are grouped per file and written to the `ranges` facet: the coverage ingest writes them this way, and its skip compares against them in the same form. */

import type { CoveredChunk } from "../../outbound/spec-trace/deps.js";

/** Serializes a file's covered intervals (in covered order) to the `ranges` edge facet, e.g. "5-10,20-25". */
export function serializeRanges(ranges: CoveredChunk[]): string {
  return ranges.map((r) => `${r.startLine}-${r.endLine}`).join(",");
}

/** Groups covered intervals by the file they belong to, preserving covered order within each file. */
export function groupRangesByFile(
  covered: CoveredChunk[],
): Map<string, CoveredChunk[]> {
  const rangesByFile = new Map<string, CoveredChunk[]>();

  for (const range of covered) {
    (
      rangesByFile.get(range.file) ??
      rangesByFile.set(range.file, []).get(range.file)!
    ).push(range);
  }

  return rangesByFile;
}
