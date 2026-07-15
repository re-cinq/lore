// Status lookups for the spec LIST pages, read from the SAME source as the
// lists themselves: the trace graph's byte-exact document source. Only spec.md
// documents carry a `| Status |` row, so only those are fetched (batched to
// bound the fan-out). Freshness follows the CI projection on push to main.

import { fetchTraceSource } from "./trace-api";
import { parseSpecStatus, type SpecStatusInfo } from "./spec-status";

const BATCH = 10;

const isSpecDoc = (filePath: string): boolean =>
  filePath.split("/").pop() === "spec.md";

export const specStatusKey = (repo: string, filePath: string): string =>
  `${repo}::${filePath}`;

export async function fetchSpecStatusesFromGraph(
  entries: Array<{ repo: string; filePath: string }>,
): Promise<Record<string, SpecStatusInfo>> {
  const docs = entries.filter((e) => isSpecDoc(e.filePath));
  const result: Record<string, SpecStatusInfo> = {};

  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const sources = await Promise.all(
      batch.map((e) => fetchTraceSource(e.repo, e.filePath).catch(() => null)),
    );

    batch.forEach((e, j) => {
      const source = sources[j];
      const info = source ? parseSpecStatus(source) : null;

      if (info) {
        result[specStatusKey(e.repo, e.filePath)] = info;
      }
    });
  }

  return result;
}
