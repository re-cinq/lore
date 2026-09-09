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
  /** Who is searching, for the audit trail. Distinct from `agentId`, which narrows WHAT is searched: an org-wide search still has an author, and recording the scope instead left every one of them logged as "anonymous". */
  actorId?: string;
  /** Keep only these kinds of hit. The legs that cannot produce a requested kind are not run, and the fact legs filter in SQL under their LIMIT, so asking for 5 episodes yields the 5 best episodes rather than whatever episodes survived a mixed top-20. */
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
  sources: MemorySearchResult["source"][] | null;
}

function wantsKind(
  scope: SearchScope,
  ...kinds: MemorySearchResult["source"][]
): boolean {
  return (
    scope.sources === null || kinds.some((k) => scope.sources?.includes(k))
  );
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
    wantsKind(scope, "memory")
      ? vectorSearchMemories(pool, embeddingStr, scope.agent, scope.poolId)
      : [],
    wantsKind(scope, "fact", "episode")
      ? vectorSearchFacts(pool, embeddingStr, scope)
      : [],
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
    wantsKind(scope, "memory")
      ? keywordSearchMemories(pool, terms, scope.agent, scope.poolId)
      : [],
    wantsKind(scope, "fact", "episode")
      ? keywordSearchFacts(pool, terms, scope)
      : [],
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
  actorId?: string;
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
    actorId: options.actorId,
    poolName: options.poolName,
    limit: options.limit ?? 10,
    includeInvalidated: options.includeInvalidated ?? false,
    graphAugmentEnabled: options.graphAugment ?? false,
    sources: options.sources,
  };
}

/** The four search legs merged into one ranked list. Reciprocal rank fusion is what lets a vector hit and a keyword hit be compared at all — the legs score on incompatible scales, but their RANKS are commensurable. Diversification then caps how much of the result one session can occupy, so a single chatty run cannot crowd out everything else. */
async function rankedHits(
  pool: PgPool,
  query: string,
  scope: SearchScope,
  { limit }: ResolvedSearchOptions,
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

  return diversify(merged, limit);
}

/** The search scope, or null when a named pool was requested that does not exist. */
async function resolveScope(
  pool: PgPool,
  agent: string | null,
  { poolName, includeInvalidated, sources }: ResolvedSearchOptions,
): Promise<SearchScope | null> {
  const poolId = await resolvePoolId(pool, poolName);

  return poolNotFound(poolName, poolId)
    ? null
    : { agent, poolId, includeInvalidated, sources: sources ?? null };
}

/** The ranked legs, optionally widened by 1-hop graph neighbors. */
async function scopedResults(
  pool: PgPool,
  query: string,
  scope: SearchScope,
  options: ResolvedSearchOptions,
): Promise<MemorySearchResult[]> {
  const ranked = await rankedHits(pool, query, scope, options);

  // Graph augmentation widens the list with 1-hop neighbours; nothing ranked means nothing to widen.
  return options.graphAugmentEnabled && ranked.length > 0
    ? augmentWithGraphNeighbors(pool, ranked, options.limit)
    : ranked;
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
  // The audit records the author; the scope stays whatever was asked for.
  const actor = resolved.actorId ?? agent;
  const scope = await resolveScope(pool, agent, resolved);

  if (!scope) {
    // Pool does not exist — return empty
    await auditLog(pool, { agentId: actor, query, resultCount: 0 });

    return [];
  }
  const results = await scopedResults(pool, query, scope, resolved);

  return finishSearch(pool, results, {
    agentId: actor,
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
