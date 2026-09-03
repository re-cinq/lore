import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { selectList } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  JobRunSchema,
  JOB_RUN_COLUMNS,
} from "@re-cinq/lore-shared/models/job-run.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

// The analytics screen's six reads, one caller (old month-to-date /api/spend moved into /api/analytics/spend-window); job_runs alone derives from the pipeline.job_runs model, not an inline aggregate.
const AnalyticsOverviewSchema = z.object({
  task_summary: z
    .object({
      total: z.number(),
      succeeded: z.number(),
      failed: z.number(),
      active: z.number(),
    })
    .nullable(),
  usage_by_task_type: z.array(
    z.object({
      task_type: z.string(),
      task_count: z.number(),
      total_input_tokens: z.number(),
      total_output_tokens: z.number(),
    }),
  ),
  usage_by_repo: z.array(
    z.object({ target_repo: z.string(), task_count: z.number() }),
  ),
  daily_usage: z.array(
    z.object({
      day: z.string(),
      calls: z.number(),
      input_tokens: z.number(),
      output_tokens: z.number(),
    }),
  ),
  /** Tool-call timings, which only the memory audit trail records. */
  latency_stats: z.array(
    z.object({
      tool: z.string(),
      call_count: z.number(),
      p50_ms: z.number().nullable(),
      p95_ms: z.number().nullable(),
      p99_ms: z.number().nullable(),
    }),
  ),
  job_runs: z.array(wireSchema(JobRunSchema, JOB_RUN_COLUMNS)),
});

export function analyticsOverviewRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/analytics-overview",
    options: zodResponse(bearerScope("read"), AnalyticsOverviewSchema, {
      name: "AnalyticsOverview",
      description: "Pipeline and usage roll-ups",
    }),
    handler: async (_request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      const { rows: summaryRows } = await pool.query(
        `SELECT
          count(*) as total,
          count(*) FILTER (WHERE status = 'pr-created' OR status = 'merged') as succeeded,
          count(*) FILTER (WHERE status = 'failed') as failed,
          count(*) FILTER (WHERE status = 'pending' OR status = 'queued' OR status = 'running') as active
        FROM pipeline.tasks`,
      );
      const { rows: usageByTaskType } = await pool.query(
        `SELECT
          t.task_type,
          count(DISTINCT t.id) as task_count,
          COALESCE(SUM(lc.input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(lc.output_tokens), 0) as total_output_tokens
        FROM pipeline.tasks t
        LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
        GROUP BY t.task_type
        ORDER BY task_count DESC`,
      );
      const { rows: usageByRepo } = await pool.query(
        `SELECT
          t.target_repo,
          count(DISTINCT t.id) as task_count
        FROM pipeline.tasks t
        WHERE t.target_repo IS NOT NULL
        GROUP BY t.target_repo
        ORDER BY task_count DESC`,
      );
      const { rows: dailyUsage } = await pool.query(
        `SELECT
          date_trunc('day', lc.created_at)::date as day,
          count(*) as calls,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens
        FROM pipeline.llm_calls lc
        WHERE lc.created_at > current_date - interval '14 days'
        GROUP BY 1
        ORDER BY 1 DESC`,
      );
      // Latency lives in memory audit metadata, not llm_calls: these are TOOL call timings, which only the audit trail records.
      const { rows: latencyStats } = await pool.query(
        `SELECT
          operation as tool,
          count(*)::int as call_count,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::numeric) as p50_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::numeric) as p95_ms,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::numeric) as p99_ms
        FROM memory.audit_log
        WHERE metadata->>'latency_ms' IS NOT NULL
          AND created_at > now() - interval '7 days'
        GROUP BY operation
        ORDER BY call_count DESC`,
      );
      const { rows: jobRuns } = await pool.query(
        `SELECT ${selectList(JOB_RUN_COLUMNS)}
        FROM pipeline.job_runs
        ORDER BY started_at DESC
        LIMIT 20`,
      );

      return h.response({
        task_summary: summaryRows[0] ?? null,
        usage_by_task_type: usageByTaskType,
        usage_by_repo: usageByRepo,
        daily_usage: dailyUsage,
        latency_stats: latencyStats,
        job_runs: jobRuns,
      });
    },
  };
}
