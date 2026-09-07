/** The four raw vector/keyword SQL search queries behind {@link searchMemories} — memories and facts, each by vector distance and by ILIKE keyword match. */

import type { PgPool } from "../../memory-store.js";

export interface RankedRow {
  key: string;
  value: string;
  agent_id: string;
  source: "memory" | "fact" | "episode" | "graph";
  rank: number;
  id?: string;
  confidence?: string;
}

/** Raw row shape shared by the four memory/fact search SQL queries. */
interface SearchSqlRow {
  id: string;
  key: string;
  value: string;
  agent_id: string;
  source: string;
  confidence?: string;
  vec_rank?: string;
  kw_rank?: string;
}

/** The rank column is named for how the row was found — `vec_rank` by embedding distance, `kw_rank` by text match — and exactly one of them is present on any given row. */
function rankOf(row: SearchSqlRow): number {
  return Number(row.vec_rank ?? row.kw_rank);
}

function toMemoryRows(rows: SearchSqlRow[]): RankedRow[] {
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as "memory",
    rank: rankOf(r),
  }));
}

/** Facts additionally carry their confidence tier, which the caller uses to annotate results and to penalize stale entries. */
function toFactRows(rows: SearchSqlRow[]): RankedRow[] {
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as "fact",
    confidence: r.confidence,
    rank: rankOf(r),
  }));
}

const VECTOR_MEMORIES_SQL = `
    SELECT m.id, m.key, m.value, m.agent_id, 'memory' as source,
           ROW_NUMBER() OVER (ORDER BY m.embedding <=> $1::vector) as vec_rank
    FROM memory.memories m
    WHERE m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND ($2::text IS NULL OR m.agent_id = $2)
      AND ($3::uuid IS NULL OR m.pool_id = $3)
    LIMIT 20`;

const KEYWORD_MEMORIES_SQL = `
    SELECT m.id, m.key, m.value, m.agent_id, 'memory' as source,
           ROW_NUMBER() OVER (ORDER BY m.created_at DESC) as kw_rank
    FROM memory.memories m
    WHERE m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND (m.value ILIKE $1 OR m.key ILIKE $1)
      AND ($2::text IS NULL OR m.agent_id = $2)
      AND ($3::uuid IS NULL OR m.pool_id = $3)
    LIMIT 20`;

/** A fact's key is borrowed from whatever produced it — the owning memory, or the episode it was extracted from — because a fact has no key of its own to search or display by. */
const FACT_SELECT = `
    SELECT f.id, COALESCE(m.key, e.source || ':' || COALESCE(e.ref, e.id::text)) as key,
           f.fact_text as value,
           COALESCE(m.agent_id, e.agent_id) as agent_id,
           CASE WHEN f.episode_id IS NOT NULL THEN 'episode' ELSE 'fact' END as source,
           f.confidence,`;

const FACT_JOINS = `
    FROM memory.facts f
    LEFT JOIN memory.memories m ON m.id = f.memory_id
    LEFT JOIN memory.episodes e ON e.id = f.episode_id
    WHERE (m.id IS NULL OR (m.is_deleted = FALSE AND (m.expires_at IS NULL OR m.expires_at > now())))`;

const VECTOR_FACTS_SQL = `${FACT_SELECT}
           ROW_NUMBER() OVER (ORDER BY f.embedding <=> $1::vector) as vec_rank
${FACT_JOINS}
      AND ($2::text IS NULL OR COALESCE(m.agent_id, e.agent_id) = $2)
      AND ($3::boolean OR f.valid_to IS NULL)
    LIMIT 20`;

const KEYWORD_FACTS_SQL = `${FACT_SELECT}
           ROW_NUMBER() OVER (ORDER BY f.created_at DESC) as kw_rank
${FACT_JOINS}
      AND f.fact_text ILIKE $1
      AND ($2::text IS NULL OR COALESCE(m.agent_id, e.agent_id) = $2)
      AND ($3::boolean OR f.valid_to IS NULL)
    LIMIT 20`;

export async function vectorSearchMemories(
  pool: PgPool,
  embeddingStr: string,
  agentId: string | null,
  poolId: string | null,
): Promise<RankedRow[]> {
  const { rows } = await pool.query<SearchSqlRow>(VECTOR_MEMORIES_SQL, [
    embeddingStr,
    agentId,
    poolId,
  ]);

  return toMemoryRows(rows);
}

export async function vectorSearchFacts(
  pool: PgPool,
  embeddingStr: string,
  agentId: string | null,
  includeInvalidated: boolean = false,
): Promise<RankedRow[]> {
  const { rows } = await pool.query<SearchSqlRow>(VECTOR_FACTS_SQL, [
    embeddingStr,
    agentId,
    includeInvalidated,
  ]);

  return toFactRows(rows);
}

export async function keywordSearchMemories(
  pool: PgPool,
  query: string,
  agentId: string | null,
  poolId: string | null,
): Promise<RankedRow[]> {
  const { rows } = await pool.query<SearchSqlRow>(KEYWORD_MEMORIES_SQL, [
    `%${query}%`,
    agentId,
    poolId,
  ]);

  return toMemoryRows(rows);
}

export async function keywordSearchFacts(
  pool: PgPool,
  query: string,
  agentId: string | null,
  includeInvalidated: boolean = false,
): Promise<RankedRow[]> {
  const { rows } = await pool.query<SearchSqlRow>(KEYWORD_FACTS_SQL, [
    `%${query}%`,
    agentId,
    includeInvalidated,
  ]);

  return toFactRows(rows);
}
