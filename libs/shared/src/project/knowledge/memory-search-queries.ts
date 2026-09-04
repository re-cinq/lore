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

export async function vectorSearchMemories(
  pool: PgPool,
  embeddingStr: string,
  agentId: string | null,
  poolId: string | null,
): Promise<RankedRow[]> {
  const sql = `
    SELECT m.id, m.key, m.value, m.agent_id, 'memory' as source,
           ROW_NUMBER() OVER (ORDER BY m.embedding <=> $1::vector) as vec_rank
    FROM memory.memories m
    WHERE m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND ($2::text IS NULL OR m.agent_id = $2)
      AND ($3::uuid IS NULL OR m.pool_id = $3)
    LIMIT 20`;
  const { rows } = await pool.query<SearchSqlRow>(sql, [
    embeddingStr,
    agentId,
    poolId,
  ]);

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as "memory",
    rank: Number(r.vec_rank),
  }));
}

export async function vectorSearchFacts(
  pool: PgPool,
  embeddingStr: string,
  agentId: string | null,
  includeInvalidated: boolean = false,
): Promise<RankedRow[]> {
  const sql = `
    SELECT f.id, COALESCE(m.key, e.source || ':' || COALESCE(e.ref, e.id::text)) as key,
           f.fact_text as value,
           COALESCE(m.agent_id, e.agent_id) as agent_id,
           CASE WHEN f.episode_id IS NOT NULL THEN 'episode' ELSE 'fact' END as source,
           f.confidence,
           ROW_NUMBER() OVER (ORDER BY f.embedding <=> $1::vector) as vec_rank
    FROM memory.facts f
    LEFT JOIN memory.memories m ON m.id = f.memory_id
    LEFT JOIN memory.episodes e ON e.id = f.episode_id
    WHERE (m.id IS NULL OR (m.is_deleted = FALSE AND (m.expires_at IS NULL OR m.expires_at > now())))
      AND ($2::text IS NULL OR COALESCE(m.agent_id, e.agent_id) = $2)
      AND ($3::boolean OR f.valid_to IS NULL)
    LIMIT 20`;
  const { rows } = await pool.query<SearchSqlRow>(sql, [
    embeddingStr,
    agentId,
    includeInvalidated,
  ]);

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as "fact",
    confidence: r.confidence,
    rank: Number(r.vec_rank),
  }));
}

export async function keywordSearchMemories(
  pool: PgPool,
  query: string,
  agentId: string | null,
  poolId: string | null,
): Promise<RankedRow[]> {
  const pattern = `%${query}%`;
  const sql = `
    SELECT m.id, m.key, m.value, m.agent_id, 'memory' as source,
           ROW_NUMBER() OVER (ORDER BY m.created_at DESC) as kw_rank
    FROM memory.memories m
    WHERE m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND (m.value ILIKE $1 OR m.key ILIKE $1)
      AND ($2::text IS NULL OR m.agent_id = $2)
      AND ($3::uuid IS NULL OR m.pool_id = $3)
    LIMIT 20`;
  const { rows } = await pool.query<SearchSqlRow>(sql, [
    pattern,
    agentId,
    poolId,
  ]);

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as "memory",
    rank: Number(r.kw_rank),
  }));
}

export async function keywordSearchFacts(
  pool: PgPool,
  query: string,
  agentId: string | null,
  includeInvalidated: boolean = false,
): Promise<RankedRow[]> {
  const pattern = `%${query}%`;
  const sql = `
    SELECT f.id, COALESCE(m.key, e.source || ':' || COALESCE(e.ref, e.id::text)) as key,
           f.fact_text as value,
           COALESCE(m.agent_id, e.agent_id) as agent_id,
           CASE WHEN f.episode_id IS NOT NULL THEN 'episode' ELSE 'fact' END as source,
           f.confidence,
           ROW_NUMBER() OVER (ORDER BY f.created_at DESC) as kw_rank
    FROM memory.facts f
    LEFT JOIN memory.memories m ON m.id = f.memory_id
    LEFT JOIN memory.episodes e ON e.id = f.episode_id
    WHERE (m.id IS NULL OR (m.is_deleted = FALSE AND (m.expires_at IS NULL OR m.expires_at > now())))
      AND f.fact_text ILIKE $1
      AND ($2::text IS NULL OR COALESCE(m.agent_id, e.agent_id) = $2)
      AND ($3::boolean OR f.valid_to IS NULL)
    LIMIT 20`;
  const { rows } = await pool.query<SearchSqlRow>(sql, [
    pattern,
    agentId,
    includeInvalidated,
  ]);

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as "fact",
    confidence: r.confidence,
    rank: Number(r.kw_rank),
  }));
}
