// The Utopia arm's `memories` and `episodes` sections (specs/utopia-graph-mirror FR13.7, FR13.9): one memory search for both, split by the kind of each hit, kept to the hits that name what the ticket names, and shaped as Lore's own items are.

import type { SourceItem } from "./context-assembly-format.js";
import {
  toEpisodeItem,
  toMemoryItem,
} from "./context-assembly-fetchers-content.js";
import { mentionsAny } from "./context-assembly-query-terms.js";
import type { FetchResult } from "./context-assembly-types.js";
import type { MemorySearchResult } from "./memory-search.js";

/** Searches the memories and episodes Utopia holds for a query, the repo's own first; null when no base has such a source. */
export type UtopiaMemoryRead = (
  query: string,
  limit: number,
) => Promise<MemorySearchResult[] | null>;

/** Three of each: an implementer's block was found to carry other tickets' DoD runs under Agent Memory on every ticket measured (2026-10-31), so a section keeps only the hits that name the ticket's files or symbols, and few of them. */
const MEMORY_SECTIONS = {
  memories: { kind: "memory", limit: 3, toItem: toMemoryItem },
  episodes: { kind: "episode", limit: 3, toItem: toEpisodeItem },
} as const;

type MemorySectionName = keyof typeof MEMORY_SECTIONS;
type MemorySection = (typeof MEMORY_SECTIONS)[MemorySectionName];

const SEARCH_LIMIT = 30;

/** Reads a memory section from one shared search, keeping the hits that name one of the ticket's terms when it has any; null for a section that is not a memory one. */
export function memorySectionReader(
  read: UtopiaMemoryRead | undefined,
  query: string,
  terms: string[] = [],
): (source: string) => Promise<FetchResult> | null {
  const search = read ? once(() => read(query, SEARCH_LIMIT)) : null;

  return (source) => {
    const section = MEMORY_SECTIONS[source as MemorySectionName] as
      MemorySection | undefined;

    return section ? answer(search, section, terms) : null;
  };
}

function aboutTicket(hit: MemorySearchResult, terms: string[]): boolean {
  return terms.length === 0 || mentionsAny(`${hit.key} ${hit.value}`, terms);
}

function once<T>(run: () => Promise<T>): () => Promise<T> {
  let started: Promise<T> | undefined;

  return () => (started ??= run());
}

async function answer(
  search: (() => Promise<MemorySearchResult[] | null>) | null,
  section: MemorySection,
  terms: string[],
): Promise<FetchResult> {
  const hits = search ? await search() : null;

  if (!hits) {
    return { sources: [], status: "disabled" };
  }
  const sources: SourceItem[] = hits
    .filter((hit) => hit.source === section.kind && aboutTicket(hit, terms))
    .slice(0, section.limit)
    .map((hit) => section.toItem(hit, new Set()));

  return { sources, status: sources.length > 0 ? "ok" : "empty" };
}
