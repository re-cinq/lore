// Status lookups for the spec/ADR LIST pages, read from the SAME source as the
// lists themselves: the trace graph's byte-exact document source. For the spec
// kind only spec.md documents carry a `| Status |` row, so only those are
// fetched; ADRs carry frontmatter status, so every entry is fetched (batched to
// bound the fan-out). Freshness follows the CI projection on push to main.

import { fetchTraceSource } from "./trace-api";
import { parseDocStatus, type DocKind, type SpecStatus } from "./spec-status";

const BATCH = 10;

const isSpecDoc = (filePath: string): boolean =>
  filePath.split("/").pop() === "spec.md";

export const specStatusKey = (repo: string, filePath: string): string =>
  `${repo}::${filePath}`;

export async function fetchDocStatusesFromGraph(
  entries: Array<{ repo: string; filePath: string }>,
  kind: DocKind,
): Promise<Record<string, SpecStatus>> {
  const docs =
    kind === "spec" ? entries.filter((e) => isSpecDoc(e.filePath)) : entries;
  const result: Record<string, SpecStatus> = {};

  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const sources = await Promise.all(
      batch.map((e) => fetchTraceSource(e.repo, e.filePath).catch(() => null)),
    );

    batch.forEach((e, j) => {
      const source = sources[j];
      const info = source ? parseDocStatus(source, kind) : null;

      if (info) {
        result[specStatusKey(e.repo, e.filePath)] = info;
      }
    });
  }

  return result;
}
