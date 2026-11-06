// The Utopia arm's `code` and `coupling` sections (specs/utopia-graph-mirror FR13.8): the `code:`, `stmt:` and `test:` hits of the shared search, of the repo's `test-coverage` source, one item per source file (`code:`), per spec statement (`stmt:`) or per test file (`test:`).

import type { SearchHit } from "../../../domain/utopia/read-shapes.js";
import type { SourceItem } from "./context-assembly-format.js";
import { ITEM_LIMITS } from "./context-assembly-fetchers-content.js";
import {
  citedSpans,
  coverageText,
} from "./context-assembly-utopia-coverage-text.js";
import {
  withBodies,
  type RepoFiles,
} from "./context-assembly-utopia-bodies.js";
import { mkItem, normalizeScores } from "./context-assembly-items.js";

export interface CoverageSection {
  prefixes: readonly string[];
  contentType: "code" | "coupling";
  limit: number;
}

export const COVERAGE_SECTIONS: Partial<Record<string, CoverageSection>> = {
  code: { prefixes: ["code:"], contentType: "code", limit: ITEM_LIMITS.code },
  coupling: {
    prefixes: ["stmt:", "test:"],
    contentType: "coupling",
    limit: 8,
  },
};

/** The coverage source's items for a section, one per external id in the rank of its best hit, scored so the best is 1; a coupling item carries the lines it cites when the repository's files can be read (FR13.8b). */
export async function coverageItems(
  hits: SearchHit[],
  coverageSourceId: string,
  section: CoverageSection,
  files?: RepoFiles,
): Promise<SourceItem[]> {
  const byId = hitsById(hits, coverageSourceId, section.prefixes);

  return normalizeScores(
    await Promise.all(
      [...byId]
        .slice(0, section.limit)
        .map(([id, chunks]) => toItem(id, chunks, section, files)),
    ),
  );
}

/** The section's hits of the coverage source by external id, in the rank of each id's first hit. */
function hitsById(
  hits: SearchHit[],
  coverageSourceId: string,
  prefixes: readonly string[],
): Map<string, SearchHit[]> {
  const byId = new Map<string, SearchHit[]>();

  for (const hit of hits) {
    const id = hit.sourceId === coverageSourceId ? hit.externalId : null;

    if (id && prefixes.some((prefix) => id.startsWith(prefix))) {
      byId.set(id, [...(byId.get(id) ?? []), hit]);
    }
  }

  return byId;
}

async function toItem(
  externalId: string,
  chunks: SearchHit[],
  section: CoverageSection,
  files: RepoFiles | undefined,
): Promise<SourceItem> {
  const texts = chunks.map((chunk) => coverageText(externalId, chunk.text));
  const lines = [...new Set(texts)].join("\n");
  const spans = chunks.flatMap((chunk) => citedSpans(externalId, chunk.text));
  const text =
    files && section.contentType === "coupling"
      ? await withBodies(lines, spans, files)
      : lines;

  return mkItem(text, {
    source_path: pathOf(externalId),
    content_type: section.contentType,
    score: Math.max(...chunks.map((chunk) => chunk.score)),
  });
}

/** `stmt:specs/a/spec.md#0003.2` keeps its statement anchor, `specs/a/spec.md#0003`, so two statements of one spec stay two items and the spec's own doc item is not dropped as seen; `test:a.test.ts#1e7912b3.2` and `code:a.ts` are their file. */
function pathOf(externalId: string): string {
  const unsplit = externalId
    .slice(externalId.indexOf(":") + 1)
    .replace(/(\.\d+)+$/, "");

  return externalId.startsWith("test:")
    ? unsplit.replace(/#[^#]*$/, "")
    : unsplit;
}
