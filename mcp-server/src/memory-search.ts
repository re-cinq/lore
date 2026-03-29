/**
 * Semantic search over agent memories.
 *
 * Uses Reciprocal Rank Fusion (RRF) to combine vector similarity and
 * keyword (ILIKE) results across memory.memories and memory.facts.
 * Degrades gracefully to keyword-only when Vertex AI embeddings are
 * unavailable.
 */

import { getQueryEmbedding } from './db.js';
import { resolveAgentId } from './agent-id.js';

// ── Types ────────────────────────────────────────────────────────────

export interface MemorySearchResult {
  key: string;
  value: string;
  score: number;
  agent_id: string;
  source: 'memory' | 'fact';
}

// ── RRF constant (matches db.ts hybrid search) ─────────────────────

const RRF_K = 60;

// ── Main entry point ────────────────────────────────────────────────

export async function searchMemories(
  pool: any,
  query: string,
  agentId?: string,
  poolName?: string,
  limit: number = 10,
): Promise<MemorySearchResult[]> {
  const agent = agentId ? resolveAgentId(agentId) : null;

  // Resolve pool name to pool_id when provided
  let poolId: string | null = null;
  if (poolName) {
    const { rows } = await pool.query(
      `SELECT id FROM memory.shared_pools WHERE name = $1`,
      [poolName],
    );
    if (rows.length > 0) {
      poolId = rows[0].id;
    } else {
      // Pool does not exist — return empty
      await auditLog(pool, agent, query, 0);
      return [];
    }
  }

  // Attempt to get query embedding from Vertex AI
  const embedding = await getQueryEmbedding(query);

  let vectorMemories: RankedRow[] = [];
  let vectorFacts: RankedRow[] = [];
  let keywordMemories: RankedRow[] = [];
  let keywordFacts: RankedRow[] = [];

  if (embedding) {
    const embeddingStr = `[${embedding.join(',')}]`;
    [vectorMemories, vectorFacts] = await Promise.all([
      vectorSearchMemories(pool, embeddingStr, agent, poolId),
      vectorSearchFacts(pool, embeddingStr, agent),
    ]);
  }

  // Keyword search always runs (provides results when embedding unavailable
  // and boosts relevant keyword matches via RRF when embedding is available)
  [keywordMemories, keywordFacts] = await Promise.all([
    keywordSearchMemories(pool, query, agent, poolId),
    keywordSearchFacts(pool, query, agent),
  ]);

  // Merge via RRF
  const merged = rrfMerge(vectorMemories, vectorFacts, keywordMemories, keywordFacts);

  // Sort descending by score and apply limit
  const results = merged
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Audit log
  await auditLog(pool, agent, query, results.length);

  return results;
}

// ── Internal types ──────────────────────────────────────────────────

interface RankedRow {
  key: string;
  value: string;
  agent_id: string;
  source: 'memory' | 'fact';
  rank: number;
}

/** Composite key for deduplication across result sets */
function resultKey(r: { key: string; agent_id: string; source: string; value: string }): string {
  return `${r.agent_id}::${r.source}::${r.key}::${r.value}`;
}

// ── Vector searches ─────────────────────────────────────────────────

async function vectorSearchMemories(
  pool: any,
  embeddingStr: string,
  agentId: string | null,
  poolId: string | null,
): Promise<RankedRow[]> {
  const sql = `
    SELECT m.key, m.value, m.agent_id, 'memory' as source,
           ROW_NUMBER() OVER (ORDER BY m.embedding <=> $1::vector) as vec_rank
    FROM memory.memories m
    WHERE m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND ($2::text IS NULL OR m.agent_id = $2)
      AND ($3::uuid IS NULL OR m.pool_id = $3)
    LIMIT 20`;
  const { rows } = await pool.query(sql, [embeddingStr, agentId, poolId]);
  return rows.map((r: any) => ({
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as 'memory',
    rank: Number(r.vec_rank),
  }));
}

async function vectorSearchFacts(
  pool: any,
  embeddingStr: string,
  agentId: string | null,
): Promise<RankedRow[]> {
  const sql = `
    SELECT m.key, f.fact_text as value, m.agent_id, 'fact' as source,
           ROW_NUMBER() OVER (ORDER BY f.embedding <=> $1::vector) as vec_rank
    FROM memory.facts f
    JOIN memory.memories m ON m.id = f.memory_id
    WHERE m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND ($2::text IS NULL OR m.agent_id = $2)
    LIMIT 20`;
  const { rows } = await pool.query(sql, [embeddingStr, agentId]);
  return rows.map((r: any) => ({
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as 'fact',
    rank: Number(r.vec_rank),
  }));
}

// ── Keyword searches ────────────────────────────────────────────────

async function keywordSearchMemories(
  pool: any,
  query: string,
  agentId: string | null,
  poolId: string | null,
): Promise<RankedRow[]> {
  const pattern = `%${query}%`;
  const sql = `
    SELECT m.key, m.value, m.agent_id, 'memory' as source,
           ROW_NUMBER() OVER (ORDER BY m.created_at DESC) as kw_rank
    FROM memory.memories m
    WHERE m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND (m.value ILIKE $1 OR m.key ILIKE $1)
      AND ($2::text IS NULL OR m.agent_id = $2)
      AND ($3::uuid IS NULL OR m.pool_id = $3)
    LIMIT 20`;
  const { rows } = await pool.query(sql, [pattern, agentId, poolId]);
  return rows.map((r: any) => ({
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as 'memory',
    rank: Number(r.kw_rank),
  }));
}

async function keywordSearchFacts(
  pool: any,
  query: string,
  agentId: string | null,
): Promise<RankedRow[]> {
  const pattern = `%${query}%`;
  const sql = `
    SELECT m.key, f.fact_text as value, m.agent_id, 'fact' as source,
           ROW_NUMBER() OVER (ORDER BY f.created_at DESC) as kw_rank
    FROM memory.facts f
    JOIN memory.memories m ON m.id = f.memory_id
    WHERE m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND f.fact_text ILIKE $1
      AND ($2::text IS NULL OR m.agent_id = $2)
    LIMIT 20`;
  const { rows } = await pool.query(sql, [pattern, agentId]);
  return rows.map((r: any) => ({
    key: r.key,
    value: r.value,
    agent_id: r.agent_id,
    source: r.source as 'fact',
    rank: Number(r.kw_rank),
  }));
}

// ── Reciprocal Rank Fusion ──────────────────────────────────────────

function rrfMerge(
  vectorMemories: RankedRow[],
  vectorFacts: RankedRow[],
  keywordMemories: RankedRow[],
  keywordFacts: RankedRow[],
): MemorySearchResult[] {
  const scoreMap = new Map<string, { row: RankedRow; score: number }>();

  function addScores(rows: RankedRow[], rankField: 'rank'): void {
    for (const row of rows) {
      const k = resultKey(row);
      const rrfScore = 1.0 / (RRF_K + row[rankField]);
      const existing = scoreMap.get(k);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scoreMap.set(k, { row, score: rrfScore });
      }
    }
  }

  addScores(vectorMemories, 'rank');
  addScores(vectorFacts, 'rank');
  addScores(keywordMemories, 'rank');
  addScores(keywordFacts, 'rank');

  return Array.from(scoreMap.values()).map(({ row, score }) => ({
    key: row.key,
    value: row.value,
    score,
    agent_id: row.agent_id,
    source: row.source,
  }));
}

// ── Audit helper ────────────────────────────────────────────────────

async function auditLog(
  pool: any,
  agentId: string | null,
  query: string,
  resultCount: number,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO memory.audit_log (agent_id, operation, memory_key, metadata)
       VALUES ($1, $2, NULL, $3)`,
      [
        agentId || 'anonymous',
        'search',
        JSON.stringify({ query, result_count: resultCount }),
      ],
    );
  } catch {
    // Audit failures must never block search operations
  }
}
