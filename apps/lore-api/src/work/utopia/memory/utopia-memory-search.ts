// Memory search's Utopia arm: the bases a memory can live in are searched, their stored `memories`/`episodes` sources picked out of the hits, and the documents answered as memory hits. Reads only: a base nothing was pushed to is skipped, never set up.

import type { Pool } from "pg";
import type { UtopiaEnv } from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { UtopiaReads } from "@re-cinq/lore-shared/utopia/utopia-reads.js";
import type { MemorySearchResult } from "@re-cinq/lore-shared/project/knowledge/memory-search.js";
import {
  normalizeHitScores,
  utopiaMemoryHits,
  type MemorySourceIds,
} from "@re-cinq/lore-shared/project/knowledge/memory-search-utopia.js";
import { memorySourceFor } from "../../../outbound/utopia-memory-sources.js";
import { orgMemoryBase } from "./utopia-memory-base.js";

export interface UtopiaMemoryQuery {
  query: string;
  agentId?: string;
  repo?: string;
  limit: number;
}

const PAGE = { topK: 50, offset: 0 };

interface SearchableBase {
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
  const bases = await Promise.all(
    baseNames(asked.repo, env).map((base) => storedSources(pool, base)),
  );
  const searchable = bases.filter(
    (base): base is SearchableBase => base !== null,
  );

  if (searchable.length === 0) {
    return null;
  }
  const perBase = await Promise.all(
    searchable.map(async (base) => {
      const page = await reads.search(base.kbId, asked.query, PAGE);

      return utopiaMemoryHits(page.hits, base.sources, {
        agentId: asked.agentId,
        limit: asked.limit,
      });
    }),
  );

  return normalizeHitScores(
    perBase
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, asked.limit),
  );
}

/** The repo's base first, then the org's; one entry when they are the same or there is no org. */
function baseNames(repo: string | undefined, env: UtopiaEnv): string[] {
  const org = orgMemoryBase(env)?.name;

  return [
    ...new Set([repo, org].filter((name): name is string => Boolean(name))),
  ];
}

/** The base's stored sources and the knowledge base they are in; null when neither kind was ever pushed. */
async function storedSources(
  pool: Pool,
  base: string,
): Promise<SearchableBase | null> {
  const [memories, episodes] = await Promise.all([
    memorySourceFor(pool, base, "memories"),
    memorySourceFor(pool, base, "episodes"),
  ]);
  const either = memories ?? episodes;

  return either
    ? {
        kbId: either.kbId,
        sources: {
          memories: memories?.id ?? null,
          episodes: episodes?.id ?? null,
        },
      }
    : null;
}
