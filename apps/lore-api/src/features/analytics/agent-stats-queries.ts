import type { Pool } from "pg";
import {
  agentHealth,
  agentStats,
} from "@re-cinq/lore-server-core/features/memory/memory.js";

/**
 * One agent's memory health + learning statistics, merged. Moved here from the
 * `lore_agent_stats` MCP tool when that tool became a pure proxy (ADR-032):
 * `agentHealth` / `agentStats` read the memory pool, the episode reads take the
 * request pool, and both live where the credentials are.
 */

export interface AgentStatsBundle {
  recent_episodes: { total_count: number; latest: unknown[] };
  [key: string]: unknown;
}

export async function agentStatsBundle(
  pool: Pool,
  agentId: string,
): Promise<AgentStatsBundle> {
  const [health, stats, episodes] = await Promise.all([
    agentHealth(agentId),
    agentStats(agentId),
    pool
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
      // Best-effort: an agent with no episode history is still worth reporting.
      .catch(() => ({ rows: [] })),
  ]);
  const total = await pool
    .query<{ total: number }>(
      `SELECT count(*)::int as total FROM memory.episodes WHERE agent_id = $1`,
      [agentId],
    )
    .then(({ rows }) => rows[0]?.total ?? 0)
    .catch(() => 0);

  return {
    ...health,
    ...stats,
    recent_episodes: { total_count: total, latest: episodes.rows },
  };
}
