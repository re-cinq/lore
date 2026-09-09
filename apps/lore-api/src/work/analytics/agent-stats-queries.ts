import type { Pool } from "pg";
import {
  agentHealth,
  agentStats,
} from "@re-cinq/lore-server-core/features/memory/memory.js";

// Agent memory health + learning stats, merged; moved from MCP tool when it became pure proxy (ADR-032).
export interface AgentStatsBundle {
  recent_episodes: { total_count: number; latest: unknown[] };
  [key: string]: unknown;
}

// LEFT(content, 200) keeps the row small: episode bodies are unbounded and only a preview is ever rendered.
const RECENT_EPISODES_SQL = `SELECT e.id, e.source, e.ref, e.created_at,
          LEFT(e.content, 200) as content_preview,
          (SELECT count(*)::int FROM memory.facts f WHERE f.episode_id = e.id) as fact_count
   FROM memory.episodes e
   WHERE e.agent_id = $1
   ORDER BY e.created_at DESC
   LIMIT 5`;

const EPISODE_COUNT_SQL = `SELECT count(*)::int as total FROM memory.episodes WHERE agent_id = $1`;

export async function agentStatsBundle(
  pool: Pool,
  agentId: string,
): Promise<AgentStatsBundle> {
  const [health, stats, recentEpisodes] = await Promise.all([
    agentHealth(agentId),
    agentStats(agentId),
    readRecentEpisodes(pool, agentId),
  ]);

  return {
    ...health,
    ...stats,
    recent_episodes: recentEpisodes,
  };
}

/** The agent's five most recent episodes, with a preview and each one's fact count. */
async function readRecentEpisodes(pool: Pool, agentId: string) {
  const [latest, total] = await Promise.all([
    readLatestEpisodes(pool, agentId),
    countEpisodes(pool, agentId),
  ]);

  return { total_count: total, latest };
}

/** Best-effort: an agent with no episode history at all is still worth reporting on, so a failed read yields an empty list rather than sinking the health and stats beside it. */
async function readLatestEpisodes(pool: Pool, agentId: string) {
  const result = await pool
    .query(RECENT_EPISODES_SQL, [agentId])
    .catch(() => ({ rows: [] }));

  return result.rows;
}

/** Best-effort for the same reason as the listing above. */
async function countEpisodes(pool: Pool, agentId: string): Promise<number> {
  return pool
    .query<{ total: number }>(EPISODE_COUNT_SQL, [agentId])
    .then(({ rows }) => rows[0]?.total ?? 0)
    .catch(() => 0);
}
