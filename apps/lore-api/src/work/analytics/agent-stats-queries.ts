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

/** The agent's five most recent episodes, with a preview and each one's fact count. Both reads are best-effort: an agent with no episode history at all is still worth reporting on, and a missing history must not cost the health and stats beside it. */
async function readRecentEpisodes(pool: Pool, agentId: string) {
  const latest = await pool
    .query(
      `SELECT e.id, e.source, e.ref, e.created_at,
                LEFT(e.content, 200) as content_preview,
                (SELECT count(*)::int FROM memory.facts f WHERE f.episode_id = e.id) as fact_count
         FROM memory.episodes e
         WHERE e.agent_id = $1
         ORDER BY e.created_at DESC
         LIMIT 5`,
      [agentId],
    )
    .catch(() => ({ rows: [] }));
  const total = await pool
    .query<{ total: number }>(
      `SELECT count(*)::int as total FROM memory.episodes WHERE agent_id = $1`,
      [agentId],
    )
    .then(({ rows }) => rows[0]?.total ?? 0)
    .catch(() => 0);

  return { total_count: total, latest: latest.rows };
}

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
