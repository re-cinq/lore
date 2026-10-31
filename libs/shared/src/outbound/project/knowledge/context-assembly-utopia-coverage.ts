// The Utopia arm's `code` and `coupling` sections (specs/utopia-graph-mirror FR13.8): the `code:`, `stmt:` and `test:` hits of the shared search, of the repo's `test-coverage` source, one item per source file (`code:`), per spec statement (`stmt:`) or per test file (`test:`).

import type { SearchHit } from "../../../domain/utopia/read-shapes.js";
import type { SourceItem } from "./context-assembly-format.js";
import { ITEM_LIMITS } from "./context-assembly-fetchers-content.js";
import { coverageText } from "./context-assembly-utopia-coverage-text.js";
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

/** The coverage source's items for a section, one per external id in the rank of its best hit, scored so the best is 1. */
export function coverageItems(
  hits: SearchHit[],
  coverageSourceId: string,
  section: CoverageSection,
): SourceItem[] {
  const byId = new Map<string, SearchHit[]>();

  for (const hit of hits) {
    const id = hit.sourceId === coverageSourceId ? hit.externalId : null;

    if (id && section.prefixes.some((prefix) => id.startsWith(prefix))) {
      byId.set(id, [...(byId.get(id) ?? []), hit]);
    }
  }

  return normalizeScores(
    [...byId]
      .slice(0, section.limit)
      .map(([id, chunks]) => toItem(id, chunks, section)),
  );
}

function toItem(
  externalId: string,
  chunks: SearchHit[],
  section: CoverageSection,
): SourceItem {
  const texts = chunks.map((chunk) => coverageText(externalId, chunk.text));

  return mkItem([...new Set(texts)].join("\n"), {
    source_path: pathOf(externalId),
    content_type: section.contentType,
    score: Math.max(...chunks.map((chunk) => chunk.score)),
  });
}

/** `stmt:specs/a/spec.md#0003.2` is the file `specs/a/spec.md`. */
function pathOf(externalId: string): string {
  const [path] = externalId.slice(externalId.indexOf(":") + 1).split("#");

  return path;
}
