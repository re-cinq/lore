import type { Pool } from "pg";

// Per-agent delegation footprint over rolling windows; SQL moved from lore_my_usage MCP (ADR-032).
const PERIODS = [
  { name: "today", filter: "t.created_at > current_date" },
  { name: "7_day", filter: "t.created_at > current_date - interval '7 days'" },
  {
    name: "30_day",
    filter: "t.created_at > current_date - interval '30 days'",
  },
] as const;

// A COUNT/SUM aggregate over one rolling window, not any table's row.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface PeriodUsage {
  tasks: number;
  input_tokens: number;
  output_tokens: number;
}

export interface AgentUsage {
  agent_id: string;
  usage: Record<string, PeriodUsage>;
}

export async function agentUsage(
  pool: Pool,
  agentId: string,
): Promise<AgentUsage> {
  const usage: Record<string, PeriodUsage> = {};

  for (const period of PERIODS) {
    const { rows } = await pool.query<{
      tasks: number;
      input_tokens: string;
      output_tokens: string;
    }>(
      `SELECT COUNT(DISTINCT t.id)::int as tasks,
              COALESCE(SUM(lc.input_tokens), 0)::bigint as input_tokens,
              COALESCE(SUM(lc.output_tokens), 0)::bigint as output_tokens
       FROM pipeline.tasks t
       LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
       WHERE (t.created_by = $1 OR t.created_by LIKE $2 OR t.agent_id = $1)
         AND ${period.filter}`,
      // LIKE matches agent id's first 8 chars for short-prefix created_by attribution.
      [agentId, `%${agentId.substring(0, 8)}%`],
    );

    usage[period.name] = {
      tasks: rows[0].tasks,
      input_tokens: Number(rows[0].input_tokens),
      output_tokens: Number(rows[0].output_tokens),
    };
  }

  return { agent_id: agentId, usage };
}
