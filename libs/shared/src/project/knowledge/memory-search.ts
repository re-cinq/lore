/** Semantic search over agent memories via RRF (vector + keyword). */

import { getQueryEmbedding } from "../../embeddings/embedding-service.js";
import { resolveAgentId } from "../../agent-id.js";
import { diversify, rrfMerge } from "../../memory-ranking.js";
import type { PgPool } from "../../memory-store.js";
import {
  vectorSearchMemories,
  vectorSearchFacts,
  keywordSearchMemories,
  keywordSearchFacts,
  type RankedRow,
} from "./memory-search-queries.js";
import { augmentWithGraphNeighbors } from "./memory-search-graph-augment.js";

// ── Types ────────────────────────────────────────────────────────────

export interface MemorySearchResult {
  key: string;
  value: string;
  score: number;
  agent_id: string;
  source: "memory" | "fact" | "episode" | "graph";
  id?: string;
  confidence?: string;
}

// ── Main entry point ────────────────────────────────────────────────

export interface MemorySearchOptions {
  agentId?: string;
  poolName?: string;
  limit?: number;
  includeInvalidated?: boolean;
  graphAugment?: boolean;
}

/** Resolves pool name to pool_id when provided. */
async function resolvePoolId(
  pool: PgPool,
  poolName: string | undefined,
): Promise<string | null> {
  return poolName ? lookupPoolId(pool, poolName) : null;
}

/** The (agent, pool, invalidated-visibility) scope shared by every memory/fact search call. */
interface SearchScope {
  agent: string | null;
  poolId: string | null;
  includeInvalidated: boolean;
}

/** Attempts a query embedding from Vertex AI; unavailable embedding yields no vector hits (keyword search still runs). */
async function vectorSearchBoth(
  pool: PgPool,
  query: string,
  scope: SearchScope,
): Promise<[RankedRow[], RankedRow[]]> {
  const embedding = await getQueryEmbedding(query);

  if (!embedding) {
    return [[], []];
  }
  const embeddingStr = `[${embedding.join(",")}]`;

  return Promise.all([
    vectorSearchMemories(pool, embeddingStr, scope.agent, scope.poolId),
    vectorSearchFacts(
      pool,
      embeddingStr,
      scope.agent,
      scope.includeInvalidated,
    ),
  ]);
}

/** Keyword search always runs (fallback when embedding unavailable). */
async function keywordSearchBoth(
  pool: PgPool,
  query: string,
  scope: SearchScope,
): Promise<[RankedRow[], RankedRow[]]> {
  return Promise.all([
    keywordSearchMemories(pool, query, scope.agent, scope.poolId),
    keywordSearchFacts(pool, query, scope.agent, scope.includeInvalidated),
  ]);
}

function poolNotFound(
  poolName: string | undefined,
  poolId: string | null,
): boolean {
  return Boolean(poolName) && poolId === null;
}

interface ResolvedSearchOptions {
  agentId?: string;
  poolName?: string;
  limit: number;
  includeInvalidated: boolean;
  graphAugmentEnabled: boolean;
}

function resolveSearchOptions(
  options: MemorySearchOptions,
): ResolvedSearchOptions {
  return {
    agentId: options.agentId,
    poolName: options.poolName,
    limit: options.limit ?? 10,
    includeInvalidated: options.includeInvalidated ?? false,
    graphAugmentEnabled: options.graphAugment ?? false,
  };
}

/** Graph augmentation: enrich results with 1-hop graph neighbors, when enabled and there's anything to augment. */
async function applyGraphAugment(
  pool: PgPool,
  results: MemorySearchResult[],
  limit: number,
  enabled: boolean,
): Promise<MemorySearchResult[]> {
  if (!enabled || results.length === 0) {
    return results;
  }

  return augmentWithGraphNeighbors(pool, results, limit);
}

export async function searchMemories(
  pool: PgPool,
  query: string,
  options: MemorySearchOptions = {},
): Promise<MemorySearchResult[]> {
  const { agentId, poolName, limit, includeInvalidated, graphAugmentEnabled } =
    resolveSearchOptions(options);
  const searchStartTime = Date.now();
  const agent = agentId ? resolveAgentId(agentId) : null;
  const poolId = await resolvePoolId(pool, poolName);

  if (poolNotFound(poolName, poolId)) {
    // Pool does not exist — return empty
    await auditLog(pool, { agentId: agent, query, resultCount: 0 });

    return [];
  }
  const scope: SearchScope = { agent, poolId, includeInvalidated };

  const [[vectorMemories, vectorFacts], [keywordMemories, keywordFacts]] =
    await Promise.all([
      vectorSearchBoth(pool, query, scope),
      keywordSearchBoth(pool, query, scope),
    ]);

  // Merge via RRF: lists arrive pre-ranked (SQL ROW_NUMBER), rrfMerge combines them.
  const merged = rrfMerge([
    vectorMemories,
    vectorFacts,
    keywordMemories,
    keywordFacts,
  ]);

  // Sort by score and diversify to prevent one session dominating results.
  let results: MemorySearchResult[] = diversify(merged, limit);

  results = await applyGraphAugment(pool, results, limit, graphAugmentEnabled);

  // Fire-and-forget retrieval strengthening
  strengthenRetrievals(pool, results).catch(() => {});

  const latencyMs = Date.now() - searchStartTime;

  await auditLog(pool, {
    agentId: agent,
    query,
    resultCount: results.length,
    latencyMs,
  });

  return results;
}

// ── Retrieval strengthening ─────────────────────────────────────────

export async function strengthenRetrievals(
  pool: PgPool,
  results: MemorySearchResult[],
): Promise<void> {
  const factIds = results
    .filter((r) => (r.source === "fact" || r.source === "episode") && r.id)
    .map((r) => r.id!);
  const memoryIds = results
    .filter((r) => r.source === "memory" && r.id)
    .map((r) => r.id!);

  const ops: Promise<unknown>[] = [];

  if (factIds.length > 0) {
    ops.push(
      pool.query(
        `UPDATE memory.facts
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = now(),
           half_life_days = LEAST(COALESCE(half_life_days, 30) + 2, 365),
           confidence = CASE WHEN confidence = 'stale' THEN 'observed' ELSE confidence END
       WHERE id = ANY($1)`,
        [factIds],
      ),
    );
  }

  if (memoryIds.length > 0) {
    ops.push(
      pool.query(
        `UPDATE memory.memories
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = now(),
           half_life_days = LEAST(COALESCE(half_life_days, 60) + 2, 365)
       WHERE id = ANY($1)`,
        [memoryIds],
      ),
    );
  }

  await Promise.all(ops);
}

/** The id of the named shared pool, or null when no such pool exists. */
async function lookupPoolId(
  pool: PgPool,
  poolName: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM memory.shared_pools WHERE name = $1`,
    [poolName],
  );

  return rows.length === 0 ? null : rows[0].id;
}

// ── Audit helper ────────────────────────────────────────────────────

interface SearchAudit {
  agentId: string | null;
  query: string;
  resultCount: number;
  latencyMs?: number;
}

async function auditLog(
  pool: PgPool,
  { agentId, query, resultCount, latencyMs }: SearchAudit,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO memory.audit_log (agent_id, operation, memory_key, metadata)
       VALUES ($1, $2, NULL, $3)`,
      [
        agentId || "anonymous",
        "search",
        JSON.stringify({
          query,
          result_count: resultCount,
          latency_ms: latencyMs,
        }),
      ],
    );
  } catch {
    // Audit failures must never block search operations
  }
}
