import type { Pool } from "pg";
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import { isMemoryDbAvailable } from "@re-cinq/lore-server-core/features/memory/memory.js";
import { searchMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { repoContextSettings } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import {
  searchMemories,
  type MemorySearchResult,
} from "@re-cinq/lore-shared/project/knowledge/memory-search.js";
import {
  resolveBackend,
  searchBackend,
  type KnowledgeBackend,
} from "@re-cinq/lore-shared/knowledge-backend.js";
import type { UtopiaReads } from "@re-cinq/lore-shared/utopia/utopia-reads.js";
import type { MemorySearchBody } from "./memory.js";
import { searchUtopiaMemories } from "../../../work/utopia/memory/utopia-memory-search.js";

/** Lore's hits as they always were for a Lore search; for utopia or both, `{results, notes}`: Utopia's hits through the reader, or the note that it has none. A repo pinned to a backend in settings.context_backend is honoured when the search names none. */
export async function searchAction(
  pool: Pool | null,
  body: MemorySearchBody,
  utopiaReads: UtopiaReads | null,
): Promise<object> {
  const settings = await repoContextSettings(pool, body.repo);
  const backend = resolveBackend(body.backend, settings.contextBackend);

  if (backend !== "utopia") {
    await getQueryEmbedding(body.query);
  }

  if (backend === "lore") {
    return searchLoreMemories(pool, body);
  }

  return searchWithUtopia(pool, body, backend, utopiaReads);
}

async function searchWithUtopia(
  pool: Pool | null,
  body: MemorySearchBody,
  backend: KnowledgeBackend,
  utopiaReads: UtopiaReads | null,
): Promise<object> {
  const arm = utopiaMemoryArm(pool, utopiaReads, body);
  const utopiaHits = arm ? await arm() : null;
  const { results, notes } = await searchBackend<object>(
    backend,
    "search_memory",
    () => searchLabelled(pool, body),
    utopiaHits ? async () => utopiaHits : null,
  );

  return { results, notes };
}

/** Utopia's arm when the deployment can read it and the memory DB holds the sources; its null answer means no base has a memory source yet. */
function utopiaMemoryArm(
  pool: Pool | null,
  reads: UtopiaReads | null,
  body: MemorySearchBody,
): (() => Promise<MemorySearchResult[] | null>) | null {
  if (!pool || !reads || !isMemoryDbAvailable()) {
    return null;
  }

  return () =>
    searchUtopiaMemories(pool, reads, {
      query: body.query,
      agentId: body.agent_id,
      repo: body.repo,
      limit: body.limit || 10,
    });
}

/** Lore's hits labelled with their store, for an answer that also holds Utopia's. */
async function searchLabelled(
  pool: Pool | null,
  body: MemorySearchBody,
): Promise<object[]> {
  const hits = await searchLoreMemories(pool, body);

  return hits.map((hit) => ({ ...hit, backend: "lore" }));
}

async function searchLoreMemories(
  pool: Pool | null,
  body: MemorySearchBody,
): Promise<object[]> {
  return isMemoryDbAvailable()
    ? searchMemories(pool!, body.query, {
        agentId: body.agent_id,
        actorId: body.actor_id,
        poolName: body.pool_name,
        limit: body.limit || 10,
        includeInvalidated: body.include_invalidated,
        graphAugment: body.graph_augment,
      })
    : searchMemoryFile(body.query, body.agent_id, body.limit || 10);
}
