// Memory search's Utopia arm: the bases a memory can live in are searched, their stored `memories`/`episodes` sources picked out of the hits, and the documents answered as memory hits. Reads only: a base nothing was pushed to is skipped, never set up.

import type { Pool } from "pg";
import type { UtopiaEnv } from "@re-cinq/lore-shared/utopia/utopia-client.js";
import {
  utopiaReadsFrom,
  type UtopiaReads,
} from "@re-cinq/lore-shared/utopia/utopia-reads.js";
import type { UtopiaMirror } from "@re-cinq/lore-shared/project/knowledge/context-assembly-utopia.js";
import type { UtopiaMemoryRead } from "@re-cinq/lore-shared/project/knowledge/context-assembly-utopia-memory.js";
import type { AssembleOptions } from "@re-cinq/lore-shared/project/knowledge/context-assembly.js";
import type { MemorySearchResult } from "@re-cinq/lore-shared/project/knowledge/memory-search.js";
import {
  normalizeHitScores,
  utopiaMemoryHits,
  type MemorySourceIds,
} from "@re-cinq/lore-shared/project/knowledge/memory-search-utopia.js";
import {
  memorySourceFor,
  type StoredMemorySource,
} from "../../../outbound/utopia-memory-sources.js";
import { orgMemoryBase } from "./utopia-memory-base.js";

export interface UtopiaMemoryQuery {
  query: string;
  agentId?: string;
  repo?: string;
  limit: number;
  /** Rank the repo base's hits ahead of the org base's whatever their scores, for a reader that wants the repo's own memories first. */
  repoFirst?: boolean;
}

const PAGE = { topK: 50, offset: 0 };

interface SearchableBase {
  name: string;
  kbId: string;
  sources: MemorySourceIds;
}

/** The hits of the repo's base (when the search names a repo) and the org base, best first, cut to the limit; null when no base has a memory source yet, so the caller says Utopia has no reader rather than answering an empty store. */
export async function searchUtopiaMemories(
  pool: Pool,
  reads: UtopiaReads,
  asked: UtopiaMemoryQuery,
  env: UtopiaEnv = process.env,
): Promise<MemorySearchResult[] | null> {
  const stored = await Promise.all(
    baseNames(asked.repo, env).map((base) => storedSources(pool, base)),
  );
  const bases = stored.filter((base): base is SearchableBase => base !== null);

  if (bases.length === 0) {
    return null;
  }
  const hits = await Promise.all(
    bases.map((base) => searchBase(reads, base, asked)),
  );

  return rankedHits(hits, bases, asked);
}

async function searchBase(
  reads: UtopiaReads,
  base: SearchableBase,
  asked: UtopiaMemoryQuery,
): Promise<MemorySearchResult[]> {
  const page = await reads.search(base.kbId, asked.query, PAGE);

  return utopiaMemoryHits(page.hits, base.sources, {
    agentId: asked.agentId,
    limit: asked.limit,
  });
}

/** The bases' hits ranked together by Utopia's own scores (the repo base's ahead of the rest when asked), cut to the limit, and only then scaled so the best is 1. */
function rankedHits(
  hitsPerBase: MemorySearchResult[][],
  bases: SearchableBase[],
  asked: UtopiaMemoryQuery,
): MemorySearchResult[] {
  const byScore = (a: MemorySearchResult, b: MemorySearchResult) =>
    b.score - a.score;
  const ranked = asked.repoFirst
    ? hitsPerBase.flatMap((hits, index) =>
        bases[index].name === asked.repo ? [...hits].sort(byScore) : [],
      )
    : [];
  const rest = hitsPerBase.flatMap((hits, index) =>
    asked.repoFirst && bases[index].name === asked.repo ? [] : hits,
  );

  return normalizeHitScores(
    [...ranked, ...rest.sort(byScore)].slice(0, asked.limit),
  );
}

/** The repo's base first, then the org's; one entry when they are the same or there is no org. */
function baseNames(repo: string | undefined, env: UtopiaEnv): string[] {
  const org = orgMemoryBase(env)?.name;

  return [
    ...new Set([repo, org].filter((name): name is string => Boolean(name))),
  ];
}

const idOf = (source: StoredMemorySource | null): string | null =>
  source?.id ?? null;

/** The base's stored sources and the knowledge base they are in; null when neither kind was ever pushed. */
async function storedSources(
  pool: Pool,
  base: string,
): Promise<SearchableBase | null> {
  const [memories, episodes] = await Promise.all([
    memorySourceFor(pool, base, "memories"),
    memorySourceFor(pool, base, "episodes"),
  ]);
  const kbId = (memories ?? episodes)?.kbId;

  return kbId
    ? {
        name: base,
        kbId,
        sources: { memories: idOf(memories), episodes: idOf(episodes) },
      }
    : null;
}

/** What an assembly needs to read Utopia: the reader, the repo's mirror and the memory search its `memories` and `episodes` sections go through; the search is absent without a reader. */
export function utopiaAssemblyOptions(
  pool: Pool,
  repo: string | undefined,
  utopiaMirror: UtopiaMirror | undefined,
  env: UtopiaEnv = process.env,
): Pick<AssembleOptions, "utopiaReads" | "utopiaMirror" | "utopiaMemories"> {
  const utopiaReads = utopiaReadsFrom(env);

  return {
    utopiaReads,
    utopiaMirror,
    utopiaMemories: utopiaReads
      ? repoFirstSearch(pool, utopiaReads, repo, env)
      : undefined,
  };
}

/** The memory search with the repo's own memories ahead of the org's. */
function repoFirstSearch(
  pool: Pool,
  reads: UtopiaReads,
  repo: string | undefined,
  env: UtopiaEnv,
): UtopiaMemoryRead {
  return (query, limit) =>
    searchUtopiaMemories(
      pool,
      reads,
      { query, repo, limit, repoFirst: true },
      env,
    );
}
