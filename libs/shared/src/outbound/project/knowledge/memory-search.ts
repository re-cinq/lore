/** Semantic search over agent memories via RRF (vector + keyword). */

import { getQueryEmbedding } from "../../embeddings/embedding-service.js";
import { resolveAgentId } from "../../agent-id.js";
import { diversify, rrfMerge } from "../../../domain/memory-ranking.js";
import { keyTermsQuery } from "../../../domain/key-terms.js";
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
  /** Keep only these kinds of hit. Applied BEFORE the limit, so asking for 5 episodes yields the 5 best episodes rather than whatever episodes survived a mixed top-5. */
  sources?: MemorySearchResult["source"][];
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

/** Keyword search always runs (fallback when embedding unavailable), on the query's distinctive terms rather than the sentence. */
async function keywordSearchBoth(
  pool: PgPool,
  query: string,
  scope: SearchScope,
): Promise<[RankedRow[], RankedRow[]]> {
  const terms = keyTermsQuery(query);

  return Promise.all([
    keywordSearchMemories(pool, terms, scope.agent, scope.poolId),
    keywordSearchFacts(pool, terms, scope.agent, scope.includeInvalidated),
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
  sources?: MemorySearchResult["source"][];
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
    sources: options.sources,
  };
}

/** The merged hits narrowed to the requested kinds; every kind when none was named. */
function ofSources(
  hits: MemorySearchResult[],
  sources: MemorySearchResult["source"][] | undefined,
): MemorySearchResult[] {
  return sources ? hits.filter((hit) => sources.includes(hit.source)) : hits;
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

/** The four search legs merged into one ranked list. Reciprocal rank fusion is what lets a vector hit and a keyword hit be compared at all — the legs score on incompatible scales, but their RANKS are commensurable. Diversification then caps how much of the result one session can occupy, so a single chatty run cannot crowd out everything else. */
async function rankedHits(
  pool: PgPool,
  query: string,
  scope: SearchScope,
  { limit, sources }: ResolvedSearchOptions,
): Promise<MemorySearchResult[]> {
  const [[vectorMemories, vectorFacts], [keywordMemories, keywordFacts]] =
    await Promise.all([
      vectorSearchBoth(pool, query, scope),
      keywordSearchBoth(pool, query, scope),
    ]);
  const merged = rrfMerge([
    vectorMemories,
    vectorFacts,
    keywordMemories,
    keywordFacts,
  ]);

  return diversify(ofSources(merged, sources), limit);
}

/** The search scope, or null when a named pool was requested that does not exist. */
async function resolveScope(
  pool: PgPool,
  agent: string | null,
  { poolName, includeInvalidated }: ResolvedSearchOptions,
): Promise<SearchScope | null> {
  const poolId = await resolvePoolId(pool, poolName);

  return poolNotFound(poolName, poolId)
    ? null
    : { agent, poolId, includeInvalidated };
}

/** The ranked legs, optionally widened by 1-hop graph neighbors. */
async function scopedResults(
  pool: PgPool,
  query: string,
  scope: SearchScope,
  options: ResolvedSearchOptions,
): Promise<MemorySearchResult[]> {
  const ranked = await rankedHits(pool, query, scope, options);

  return applyGraphAugment(
    pool,
    ranked,
    options.limit,
    options.graphAugmentEnabled,
  );
}

/** Strengthen what was retrieved, audit the search, and hand the results back unchanged. */
async function finishSearch(
  pool: PgPool,
  results: MemorySearchResult[],
  audit: Omit<SearchAudit, "resultCount">,
): Promise<MemorySearchResult[]> {
  // Fire-and-forget retrieval strengthening
  strengthenRetrievals(pool, results).catch(() => {});
  await auditLog(pool, { ...audit, resultCount: results.length });

  return results;
}

export async function searchMemories(
  pool: PgPool,
  query: string,
  options: MemorySearchOptions = {},
): Promise<MemorySearchResult[]> {
  const resolved = resolveSearchOptions(options);
  // Captures the clock BEFORE the work it times; moving it down would shorten the reported latency.
  const searchStartTime = Date.now();
  const agent = resolved.agentId ? resolveAgentId(resolved.agentId) : null;
  const scope = await resolveScope(pool, agent, resolved);

  if (!scope) {
    // Pool does not exist — return empty
    await auditLog(pool, { agentId: agent, query, resultCount: 0 });

    return [];
  }
  const results = await scopedResults(pool, query, scope, resolved);

  return finishSearch(pool, results, {
    agentId: agent,
    query,
    latencyMs: Date.now() - searchStartTime,
  });
}

// ── Retrieval strengthening ─────────────────────────────────────────

/** Retrieval is evidence a fact is still in use, so it extends the half-life and revives a `stale` fact to `observed` — a fact somebody just read is by definition not forgotten. */
const STRENGTHEN_FACTS_SQL = `UPDATE memory.facts
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = now(),
           half_life_days = LEAST(COALESCE(half_life_days, 30) + 2, 365),
           confidence = CASE WHEN confidence = 'stale' THEN 'observed' ELSE confidence END
       WHERE id = ANY($1)`;

/** Memories start with a longer default half-life (60 days) than facts and carry no confidence tier, so there is nothing to revive. */
const STRENGTHEN_MEMORIES_SQL = `UPDATE memory.memories
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = now(),
           half_life_days = LEAST(COALESCE(half_life_days, 60) + 2, 365)
       WHERE id = ANY($1)`;

function idsOf(
  results: MemorySearchResult[],
  matches: (r: MemorySearchResult) => boolean,
): string[] {
  return results.flatMap((r) => (matches(r) && r.id ? [r.id] : []));
}

export async function strengthenRetrievals(
  pool: PgPool,
  results: MemorySearchResult[],
): Promise<void> {
  const factIds = idsOf(
    results,
    (r) => r.source === "fact" || r.source === "episode",
  );
  const memoryIds = idsOf(results, (r) => r.source === "memory");

  await Promise.all([
    factIds.length > 0 ? pool.query(STRENGTHEN_FACTS_SQL, [factIds]) : null,
    memoryIds.length > 0
      ? pool.query(STRENGTHEN_MEMORIES_SQL, [memoryIds])
      : null,
  ]);
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

const SEARCH_AUDIT_SQL = `INSERT INTO memory.audit_log (agent_id, operation, memory_key, metadata)
       VALUES ($1, $2, NULL, $3)`;

async function auditLog(
  pool: PgPool,
  { agentId, query, resultCount, latencyMs }: SearchAudit,
): Promise<void> {
  const metadata = JSON.stringify({
    query,
    result_count: resultCount,
    latency_ms: latencyMs,
  });

  try {
    await pool.query(SEARCH_AUDIT_SQL, [
      agentId || "anonymous",
      "search",
      metadata,
    ]);
  } catch {
    // Audit failures must never block search operations
  }
}
