// Earlier work on a task's topic as one line each: the mirrored issues, pull requests and commits Utopia found, and the memories and sessions the memory search found.

import type { SearchHit } from "@re-cinq/lore-shared/utopia/read-shapes.js";

export interface PreviousWorkHits {
  tracker: SearchHit[];
  /** The repository's `issues`, `pull-requests` and `git-history` source ids: the only hits that are earlier work. */
  trackerSources: string[];
  /** The memory search's answer: Lore's bare list, or Utopia's `{results, notes}`. */
  memories: unknown;
}

const MAX_CHARS = 600;

export function previousWorkLines(hits: PreviousWorkHits): string[] {
  const sources = new Set(hits.trackerSources);
  const earlier = hits.tracker.filter(
    (hit) => hit.sourceId !== null && sources.has(hit.sourceId),
  );
  const tracker = earlier.map(
    (hit) => `${hit.externalId ?? hit.filename}: ${cut(hit.text)}`,
  );
  const memories = memoryHits(hits.memories).map(
    (memory) => `memory ${memory.key}: ${cut(memory.value)}`,
  );

  return [...new Set([...tracker, ...memories])];
}

function memoryHits(answer: unknown): { key: string; value: string }[] {
  const list = Array.isArray(answer) ? answer : resultsOf(answer);

  return list.flatMap((hit: unknown) => {
    const { key, value } = (hit ?? {}) as { key?: unknown; value?: unknown };

    return typeof key === "string" ? [{ key, value: String(value ?? "") }] : [];
  });
}

function resultsOf(answer: unknown): unknown[] {
  const results = (answer as { results?: unknown } | null)?.results;

  return Array.isArray(results) ? results : [];
}

function cut(text: string): string {
  return text.slice(0, MAX_CHARS);
}
