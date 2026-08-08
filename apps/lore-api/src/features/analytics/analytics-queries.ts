import type { Pool } from "pg";

/**
 * Org-wide pipeline analytics for one time window. The SQL moved here from the
 * `lore_get_analytics` MCP tool when that tool became a pure proxy (ADR-032).
 */

export const ANALYTICS_PERIODS = ["today", "week", "month", "all"] as const;

export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

const PERIOD_FILTERS: Record<AnalyticsPeriod, string> = {
  today: "created_at > current_date",
  week: "created_at > date_trunc('week', current_date)",
  month: "created_at > date_trunc('month', current_date)",
  all: "TRUE",
};

export interface PipelineAnalytics {
  period: AnalyticsPeriod;
  usage: { llm_calls: number; input_tokens: number; output_tokens: number };
  tasks: { total: number; succeeded: number; failed: number };
  /** `tasks` stays a numeric string here — it is a raw pg bigint. */
  by_type: { task_type: string; tasks: string }[];
}

export async function pipelineAnalytics(
  pool: Pool,
  period: AnalyticsPeriod,
): Promise<PipelineAnalytics> {
  const periodFilter = PERIOD_FILTERS[period];
  const [usageResult, taskResult, byTypeResult] = await Promise.all([
    pool.query<{ calls: string; input_tokens: string; output_tokens: string }>(
      `SELECT count(*) as calls, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens FROM pipeline.llm_calls WHERE ${periodFilter}`,
    ),
    pool.query<{ total: string; succeeded: string; failed: string }>(
      `SELECT count(*) as total, count(*) FILTER (WHERE status IN ('pr-created', 'merged')) as succeeded, count(*) FILTER (WHERE status = 'failed') as failed FROM pipeline.tasks WHERE ${periodFilter}`,
    ),
    pool.query<{ task_type: string; tasks: string }>(
      `SELECT t.task_type, count(DISTINCT t.id) as tasks FROM pipeline.tasks t WHERE ${periodFilter} GROUP BY t.task_type ORDER BY tasks DESC`,
    ),
  ]);

  return {
    period,
    usage: {
      llm_calls: parseInt(usageResult.rows[0].calls),
      input_tokens: parseInt(usageResult.rows[0].input_tokens),
      output_tokens: parseInt(usageResult.rows[0].output_tokens),
    },
    tasks: {
      total: parseInt(taskResult.rows[0].total),
      succeeded: parseInt(taskResult.rows[0].succeeded),
      failed: parseInt(taskResult.rows[0].failed),
    },
    by_type: byTypeResult.rows,
  };
}
