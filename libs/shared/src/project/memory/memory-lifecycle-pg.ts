import type { PgPool } from "../../memory-store.js";
import type {
  MemoryLifecyclePort,
  AgentCount,
  DecayCandidate,
  RecentFact,
  MemoryUpsert,
  EpisodeInsert,
  AuditLogInsert,
} from "./memory-lifecycle-port.js";

/**
 * Postgres-backed {@link MemoryLifecyclePort}. Each method carries the exact
 * `memory.*` statement from its origin Floor job so the runner reaches the
 * lifecycle SQL through the Project facade instead of a job-local `query()`.
 */
export class PgMemoryLifecycle implements MemoryLifecyclePort {
  constructor(private readonly pool: PgPool) {}

  // memory.memories ──────────────────────────────────────────────────

  async countMemoriesByAgentOverCap(cap: number): Promise<AgentCount[]> {
    const { rows } = await this.pool.query(
      `SELECT agent_id, count(*)::int AS cnt
     FROM memory.memories
     WHERE is_deleted = FALSE
     GROUP BY agent_id
     HAVING count(*) > $1`,
      [cap],
    );
    return rows as AgentCount[];
  }

  async findDecayCandidates(
    agentId: string,
    limit: number,
    minAgeDays: number,
  ): Promise<DecayCandidate[]> {
    const { rows } = await this.pool.query(
      `SELECT id, key, value, created_at, last_retrieved_at, half_life_days, retrieval_count
       FROM memory.memories
       WHERE agent_id = $1 AND is_deleted = FALSE
         AND created_at < now() - interval '${minAgeDays} days'
       ORDER BY created_at ASC
       LIMIT $2`,
      [agentId, limit],
    );
    return rows as DecayCandidate[];
  }

  async softDeleteMemories(ids: string[]): Promise<void> {
    await this.pool.query(
      `UPDATE memory.memories SET is_deleted = TRUE
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async insertConsolidatedMemory(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory.memories (agent_id, key, value, version)
           VALUES ('consolidation', $1, $2, 1)
           ON CONFLICT (agent_id, key, version) DO NOTHING`,
      [key, value],
    );
  }

  async expireMemories(): Promise<number> {
    const { rows } = await this.pool.query(
      `WITH expired AS (
       UPDATE memory.memories
       SET is_deleted = true
       WHERE expires_at IS NOT NULL
         AND expires_at < now()
         AND is_deleted = false
       RETURNING id
     )
     SELECT count(*)::text AS count FROM expired`,
    );
    return parseInt(rows[0]?.count || "0", 10);
  }

  async upsertMemory(memory: MemoryUpsert): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory.memories (agent_id, key, value, version)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (agent_id, key, version) DO UPDATE SET value = EXCLUDED.value`,
      [memory.agentId, memory.key, memory.value],
    );
  }

  async appendMemory(
    agentId: string,
    key: string,
    value: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory.memories (agent_id, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (agent_id, key) DO UPDATE SET value = memory.memories.value || E'\n' || $3, version = memory.memories.version + 1`,
      [agentId, key, value],
    );
  }

  // memory.facts ─────────────────────────────────────────────────────

  async countInvalidatedFactsByAgentOverCap(
    cap: number,
    minAgeDays: number,
  ): Promise<AgentCount[]> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(m.agent_id, e.agent_id) AS agent_id, count(*)::int AS cnt
     FROM memory.facts f
     LEFT JOIN memory.memories m ON m.id = f.memory_id
     LEFT JOIN memory.episodes e ON e.id = f.episode_id
     WHERE f.valid_to IS NOT NULL
       AND f.valid_to < now() - interval '${minAgeDays} days'
     GROUP BY COALESCE(m.agent_id, e.agent_id)
     HAVING count(*) > $1`,
      [cap],
    );
    return rows as AgentCount[];
  }

  async deleteOldestInvalidatedFacts(
    limit: number,
    minAgeDays: number,
  ): Promise<number> {
    const { rows } = await this.pool.query(
      `WITH oldest AS (
         SELECT id FROM memory.facts
         WHERE valid_to IS NOT NULL
           AND valid_to < now() - interval '${minAgeDays} days'
         ORDER BY valid_to ASC
         LIMIT $1
       )
       DELETE FROM memory.facts WHERE id IN (SELECT id FROM oldest)
       RETURNING id`,
      [limit],
    );
    return rows.length;
  }

  async transitionStaleFacts(): Promise<number> {
    const { rows } = await this.pool.query(
      `UPDATE memory.facts
       SET confidence = 'stale'
       WHERE valid_to IS NULL
         AND confidence NOT IN ('stale', 'verified')
         AND COALESCE(last_retrieved_at, created_at) < now() - interval '30 days'
       RETURNING id`,
    );
    return rows.length;
  }

  async findRecentValidFacts(
    lookbackDays: number,
    limit: number,
  ): Promise<RecentFact[]> {
    const { rows } = await this.pool.query(
      `SELECT f.fact_text, COALESCE(e.ref, 'unknown') AS repo
     FROM memory.facts f
     LEFT JOIN memory.episodes e ON e.id = f.episode_id
     WHERE f.valid_to IS NULL
       AND f.created_at > now() - interval '${lookbackDays} days'
     ORDER BY f.created_at DESC
     LIMIT ${limit}`,
    );
    return rows as RecentFact[];
  }

  // PR-outcome feedback (merge-check.ts) ─────────────────────────────

  async boostContributors(
    factIds: string[],
    memoryIds: string[],
  ): Promise<void> {
    if (factIds.length > 0) {
      await this.pool.query(
        `UPDATE memory.facts SET half_life_days = LEAST(COALESCE(half_life_days, 30) + 5, 365) WHERE id = ANY($1::uuid[])`,
        [factIds],
      );
    }
    if (memoryIds.length > 0) {
      await this.pool.query(
        `UPDATE memory.memories SET half_life_days = LEAST(COALESCE(half_life_days, 60) + 5, 365) WHERE id = ANY($1::uuid[])`,
        [memoryIds],
      );
    }
  }

  async penalizeContributors(
    factIds: string[],
    memoryIds: string[],
  ): Promise<void> {
    if (factIds.length > 0) {
      await this.pool.query(
        `UPDATE memory.facts SET half_life_days = GREATEST(7, COALESCE(half_life_days, 30) - 3) WHERE id = ANY($1::uuid[])`,
        [factIds],
      );
    }
    if (memoryIds.length > 0) {
      await this.pool.query(
        `UPDATE memory.memories SET half_life_days = GREATEST(7, COALESCE(half_life_days, 60) - 3) WHERE id = ANY($1::uuid[])`,
        [memoryIds],
      );
    }
  }

  // memory.audit_log ─────────────────────────────────────────────────

  async writeAuditLog(entry: AuditLogInsert): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory.audit_log (agent_id, operation, metadata)
       VALUES ($1, $2, $3)`,
      [entry.agentId, entry.operation, JSON.stringify(entry.metadata)],
    );
  }

  // memory.episodes ──────────────────────────────────────────────────

  async insertEpisode(episode: EpisodeInsert): Promise<string | null> {
    const { rows } = await this.pool.query(
      `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, content_hash) DO NOTHING
       RETURNING id`,
      [
        episode.agentId,
        episode.content,
        episode.contentHash,
        episode.source,
        episode.ref,
      ],
    );
    return rows[0]?.id || null;
  }
}
