import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import type { Pool, QueryResultRow } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/**
 * `GET /api/spend` — the whole spend screen in one call, moved out of web-ui
 * (ADR-032). Ten month-to-date aggregates that only ever render together.
 *
 * Two sources, deliberately both: `pipeline.anthropic_cost_daily` is Anthropic's
 * authoritative BILLED cost, written once a day by the cost-sync cron — its
 * buckets close at UTC midnight and the in-progress day is never emitted, so the
 * billed total always ends at yesterday. `pipeline.llm_calls` is Lore's own
 * computed cost, token-exact against the hourly usage report and available with
 * no admin key, which is what brings the billed figure current.
 */

const MTD = "created_at >= date_trunc('month', current_date)";
const UNDEFINED_TABLE = "42P01";

/** The billed-cost reads degrade to empty: the table arrives with a migration
 *  and the sync with a cron, and a cluster missing either must still render the
 *  Lore-computed half rather than 500. */
async function billedRows<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
): Promise<T[]> {
  try {
    const { rows } = await pool.query<T>(sql);

    return rows;
  } catch (err) {
    if ((err as { code?: string }).code === UNDEFINED_TABLE) {
      return [];
    }

    throw err;
  }
}

/**
 * `GET /api/analytics-overview` — the analytics screen's six reads. Same
 * shape-per-screen rule as spend: they render together and have one caller.
 */
/** The analytics dashboard's roll-ups — every field is a SQL aggregate. */
const AnalyticsOverviewSchema = z.object({
  task_summary: z.record(z.unknown()).nullable(),
  usage_by_task_type: z.array(z.record(z.unknown())),
  usage_by_repo: z.array(z.record(z.unknown())),
  daily_usage: z.array(z.record(z.unknown())),
  latency_stats: z.array(z.record(z.unknown())),
  job_runs: z.array(z.record(z.unknown())),
});

/**
 * Spend from TWO sources, deliberately: Anthropic's own billing (`org_*`) and
 * what this platform attributes to itself (`lore_*`). They are reported side by
 * side rather than reconciled, because only one of them is authoritative.
 */
const SpendSchema = z.record(z.unknown());

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

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

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
      // Latency lives in the memory audit metadata, not in llm_calls: these are
      // TOOL call timings, which only the audit trail records.
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
        `SELECT id, job_name, started_at, completed_at, status, result_summary, error, log_path
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

export function spendRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/spend",
    options: zodResponse(bearerScope("read"), SpendSchema, {
      name: "Spend",
      description: "Billed and attributed spend, side by side",
    }),
    handler: async (_request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      const orgMtdRows = await billedRows<{
        billed_usd: number;
        input_tokens: number;
        output_tokens: number;
        as_of: string | null;
      }>(
        pool,
        `SELECT
           COALESCE(SUM(cost_usd), 0)::float8 AS billed_usd,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           MAX(fetched_at) AS as_of
         FROM pipeline.anthropic_cost_daily
         WHERE bucket_date >= date_trunc('month', current_date)`,
      );
      const orgByModel = await billedRows(
        pool,
        `SELECT model, SUM(cost_usd)::float8 AS cost_usd,
           SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
         FROM pipeline.anthropic_cost_daily
         WHERE bucket_date >= date_trunc('month', current_date)
         GROUP BY model ORDER BY cost_usd DESC`,
      );
      const orgDaily = await billedRows(
        pool,
        `SELECT bucket_date, SUM(cost_usd)::float8 AS cost_usd
         FROM pipeline.anthropic_cost_daily
         WHERE bucket_date >= date_trunc('month', current_date)
         GROUP BY bucket_date ORDER BY bucket_date DESC`,
      );

      // `as_of`, not a row count: an empty month reads as zero cost either way,
      // but only the stamp distinguishes "the sync has run and we owe nothing"
      // from "nothing has ever synced", and the view hides the section for the
      // second rather than showing a confident zero.
      const orgMtd = orgMtdRows[0];
      const orgAvailable = !!orgMtd?.as_of;

      const { rows: todayRows } = await pool.query<{ cost_usd: number }>(
        `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
         FROM pipeline.llm_calls WHERE created_at >= current_date`,
      );
      const { rows: loreMtdRows } = await pool.query(
        `SELECT
           COALESCE(SUM(cost_usd), 0)::float8 AS computed_usd,
           COUNT(*)::int AS calls,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM pipeline.llm_calls WHERE ${MTD}`,
      );
      const { rows: loreByModel } = await pool.query(
        `SELECT model, COUNT(*)::int AS calls, SUM(cost_usd)::float8 AS cost_usd,
           SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
         FROM pipeline.llm_calls WHERE ${MTD}
         GROUP BY model ORDER BY cost_usd DESC`,
      );
      // The only view that separates code-review lines (task-less) from tasks
      // from the memory/curation jobs.
      const { rows: loreByKind } = await pool.query(
        `SELECT
           CASE
             WHEN task_id IS NULL AND assembly_line_id IS NOT NULL
               THEN 'Code review / detection line'
             WHEN task_id IS NOT NULL
               THEN 'Task (implementation / spec / general)'
             WHEN job_name IN ('fact-extraction','graph-extraction','consolidation','auto-curation')
               THEN 'Memory & curation'
             ELSE COALESCE(NULLIF(job_name, ''), 'other')
           END AS kind,
           COUNT(*)::int AS calls, SUM(cost_usd)::float8 AS cost_usd
         FROM pipeline.llm_calls WHERE ${MTD}
         GROUP BY 1 ORDER BY cost_usd DESC`,
      );
      const { rows: loreDaily } = await pool.query(
        `SELECT created_at::date AS bucket_date, COUNT(*)::int AS calls,
           SUM(cost_usd)::float8 AS cost_usd
         FROM pipeline.llm_calls WHERE ${MTD}
         GROUP BY 1 ORDER BY 1 DESC`,
      );
      const { rows: loreByRepo } = await pool.query(
        `SELECT t.target_repo, COUNT(DISTINCT t.id) AS tasks,
           SUM(lc.cost_usd)::float8 AS cost_usd
         FROM pipeline.llm_calls lc JOIN pipeline.tasks t ON t.id = lc.task_id
         WHERE lc.${MTD} AND t.target_repo IS NOT NULL
         GROUP BY t.target_repo ORDER BY cost_usd DESC`,
      );
      const { rows: loreByTaskType } = await pool.query(
        `SELECT t.task_type, COUNT(DISTINCT t.id) AS tasks,
           SUM(lc.cost_usd)::float8 AS cost_usd
         FROM pipeline.llm_calls lc JOIN pipeline.tasks t ON t.id = lc.task_id
         WHERE lc.${MTD}
         GROUP BY t.task_type ORDER BY cost_usd DESC`,
      );

      return h.response({
        org_available: orgAvailable,
        org_mtd: orgMtd ?? {
          billed_usd: 0,
          input_tokens: 0,
          output_tokens: 0,
          as_of: null,
        },
        org_by_model: orgByModel,
        org_daily: orgDaily,
        lore_today_usd: todayRows[0]?.cost_usd ?? 0,
        lore_mtd: loreMtdRows[0] ?? {
          computed_usd: 0,
          calls: 0,
          input_tokens: 0,
          output_tokens: 0,
        },
        lore_by_model: loreByModel,
        lore_by_kind: loreByKind,
        lore_daily: loreDaily,
        lore_by_repo: loreByRepo,
        lore_by_task_type: loreByTaskType,
      });
    },
  };
}
