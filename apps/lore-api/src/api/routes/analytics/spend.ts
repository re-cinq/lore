import { selectList } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  JobRunSchema,
  JOB_RUN_COLUMNS,
} from "@re-cinq/lore-shared/models/job-run.js";
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
 * billed total ends at the last SYNCED day, which is yesterday only while the
 * cron keeps up. `pipeline.llm_calls` is Lore's own computed cost, token-exact
 * against the hourly usage report and available with no admin key, which is
 * what brings the billed figure current — for every day past `billed_through`,
 * not for a day assumed to be today.
 */

const MTD = "created_at >= date_trunc('month', current_date)";
const UNDEFINED_TABLE = "42P01";

/** Reads of a table that may not exist yet degrade to empty rather than 500:
 *  `anthropic_cost_daily` arrives with a migration and its rows with a cron,
 *  and `credit_ledger` arrives with a migration and its rows with a person. A
 *  cluster missing any of them must still render the halves it does have. */
async function optionalTableRows<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const { rows } = await pool.query<T>(sql, params);

    return rows;
  } catch (err) {
    if ((err as { code?: string }).code === UNDEFINED_TABLE) {
      return [];
    }

    throw err;
  }
}

/**
 * `remaining = recorded balance - everything spent since the anchor`, where
 * spend is the same two sources the rest of this page reports side by side,
 * summed here because a remaining balance has to commit to one number.
 *
 * The two halves meet at `billed_through` and must not overlap: billed covers
 * up to and including it, Lore-computed starts strictly after. An off-by-one
 * either double-counts a day or drops one, and both yield a plausible-looking
 * balance that is wrong.
 */
async function remainingBudget(
  pool: Pool,
  anchoredAt: string,
  ledgerTotalUsd: number,
) {
  // MAX(bucket_date) over the WHOLE table, not this month: the anchor can
  // predate the month, and a month whose sync has not run yet would otherwise
  // report no billed day at all and shove every dollar onto the computed side.
  const [billed] = await optionalTableRows<{
    billed_usd: number;
    billed_through: string | null;
  }>(
    pool,
    `SELECT
       COALESCE(SUM(cost_usd) FILTER (WHERE bucket_date >= $1::date), 0)::float8
         AS billed_usd,
       MAX(bucket_date)::text AS billed_through
     FROM pipeline.anthropic_cost_daily`,
    [anchoredAt],
  );
  // The bound rides in as a parameter rather than a subquery, for the reason
  // the month-to-date unbilled read already gives: `anthropic_cost_daily` is
  // absent on clusters with no admin key, and a subquery against it would take
  // the Lore-computed half down with it.
  const { rows: computed } = await pool.query<{ cost_usd: number }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
       FROM pipeline.llm_calls
      WHERE created_at::date >= $1::date
        AND ($2::date IS NULL OR created_at::date > $2::date)`,
    [anchoredAt, billed?.billed_through ?? null],
  );
  const spentSinceUsd =
    (billed?.billed_usd ?? 0) + (computed[0]?.cost_usd ?? 0);

  return {
    ledger_total_usd: ledgerTotalUsd,
    spent_since_usd: spentSinceUsd,
    remaining_usd: ledgerTotalUsd - spentSinceUsd,
    anchored_at: anchoredAt,
  };
}

/**
 * `GET /api/analytics-overview` — the analytics screen's six reads. Same
 * shape-per-screen rule as spend: they render together and have one caller.
 */
/**
 * The analytics dashboard's six reads. Five are SQL aggregates and are stated
 * here, beside the queries that shape them. The sixth is not: `job_runs` selects
 * a `pipeline.job_runs` ROW, so it derives from that table's model — the one
 * place in this response where a column rename should reach the contract.
 *
 * `task_summary` is null only when the tasks table is empty.
 */
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

/**
 * Spend from TWO sources, deliberately: Anthropic's own billing (`org_*`) and
 * what this platform attributes to itself (`lore_*`). They are reported side by
 * side rather than reconciled, because only one of them is authoritative.
 *
 * Every field is a SQL aggregate, so none of it derives from a model — the
 * shapes are stated here, where the queries that produce them live.
 * `org_available` is false when no admin key is configured, and the `org_*`
 * rows are empty rather than absent, so a caller reads the same shape either
 * way.
 */
const OrgMtdSchema = z.object({
  billed_usd: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  as_of: z.string().nullable(),
  /**
   * The last day Anthropic has actually billed — `MAX(bucket_date)`, NOT
   * "yesterday". The cost report omits the in-progress day, so a current sync
   * does end at yesterday; a late or failed one ends earlier, and only this
   * stamp distinguishes the two. `as_of` records when the sync ran, which is a
   * different question and cannot answer this one.
   */
  billed_through: z.string().nullable(),
});

const LoreMtdSchema = z.object({
  computed_usd: z.number(),
  calls: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
});

/**
 * What is LEFT, which no API can tell us. Anthropic's Admin API exposes usage
 * and cost reports and no credit balance, so the balance is whatever a person
 * has recorded in `pipeline.credit_ledger` — and `remaining` is that total
 * minus everything spent since the earliest entry.
 *
 * The one figure on this page that is NOT month-to-date. A balance added in
 * June is still money in August, so clipping this window to the current month
 * would silently forgive every dollar spent before the 1st.
 *
 * Null, not zero, when the ledger is empty or its table has not been migrated
 * yet: the same distinction `org_available` draws. Nobody having told us the
 * balance is a different fact from the balance being nothing, and only one of
 * them should render as a number.
 */
const BudgetSchema = z
  .object({
    ledger_total_usd: z.number(),
    /**
     * Billed spend from the anchor through `billed_through`, plus Lore-computed
     * spend for every day strictly after it — the same two-source arithmetic
     * the rest of this page reports side by side, summed here because a
     * remaining balance has to commit to one number.
     */
    spent_since_usd: z.number(),
    /** Deliberately allowed to go negative: an overrun is the state most worth
     *  seeing, and clamping it at zero would hide precisely that day. */
    remaining_usd: z.number(),
    /** The earliest `effective_date` in the ledger — the day the arithmetic
     *  starts, shown so a stale anchor is visible rather than merely wrong. */
    anchored_at: z.string(),
  })
  .nullable();

const SpendSchema = z.object({
  budget: BudgetSchema,
  org_available: z.boolean(),
  org_mtd: OrgMtdSchema,
  org_by_model: z.array(
    z.object({
      model: z.string(),
      cost_usd: z.number(),
      input_tokens: z.number(),
      output_tokens: z.number(),
    }),
  ),
  org_daily: z.array(
    z.object({ bucket_date: z.string(), cost_usd: z.number() }),
  ),
  lore_unbilled_usd: z.number(),
  lore_unbilled_days: z.number(),
  lore_mtd: LoreMtdSchema,
  lore_by_model: z.array(
    z.object({
      model: z.string(),
      calls: z.number(),
      cost_usd: z.number(),
      input_tokens: z.number(),
      output_tokens: z.number(),
    }),
  ),
  lore_by_kind: z.array(
    z.object({
      kind: z.string(),
      calls: z.number(),
      cost_usd: z.number(),
    }),
  ),
  lore_daily: z.array(
    z.object({
      bucket_date: z.string(),
      calls: z.number(),
      cost_usd: z.number(),
    }),
  ),
  lore_by_repo: z.array(
    z.object({
      target_repo: z.string(),
      tasks: z.number(),
      cost_usd: z.number(),
    }),
  ),
  lore_by_task_type: z.array(
    z.object({
      task_type: z.string(),
      tasks: z.number(),
      cost_usd: z.number(),
    }),
  ),
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

      const orgMtdRows = await optionalTableRows<{
        billed_usd: number;
        input_tokens: number;
        output_tokens: number;
        as_of: string | null;
        billed_through: string | null;
      }>(
        pool,
        `SELECT
           COALESCE(SUM(cost_usd), 0)::float8 AS billed_usd,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           MAX(fetched_at) AS as_of,
           MAX(bucket_date)::text AS billed_through
         FROM pipeline.anthropic_cost_daily
         WHERE bucket_date >= date_trunc('month', current_date)`,
      );
      const orgByModel = await optionalTableRows(
        pool,
        `SELECT model, SUM(cost_usd)::float8 AS cost_usd,
           SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
         FROM pipeline.anthropic_cost_daily
         WHERE bucket_date >= date_trunc('month', current_date)
         GROUP BY model ORDER BY cost_usd DESC`,
      );
      const orgDaily = await optionalTableRows(
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

      // Everything Anthropic has not billed yet, which is "today" only when the
      // sync is current. The bound is passed as a parameter rather than joined
      // in: `anthropic_cost_daily` is absent on clusters with no admin key, and
      // a subquery against it would take the Lore-computed side down with it —
      // the one half that never depended on the sync.
      const { rows: unbilledRows } = await pool.query<{
        cost_usd: number;
        days: number;
      }>(
        `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd,
           COUNT(DISTINCT created_at::date)::int AS days
         FROM pipeline.llm_calls
         WHERE ${MTD} AND ($1::date IS NULL OR created_at::date > $1::date)`,
        [orgMtd?.billed_through ?? null],
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

      // Read last, so the statement ordering every other read already depends
      // on stays exactly as it was. An empty ledger yields one row whose
      // `anchored_at` is null — no anchor, no arithmetic, no budget.
      const [ledger] = await optionalTableRows<{
        ledger_total_usd: number;
        anchored_at: string | null;
      }>(
        pool,
        `SELECT COALESCE(SUM(amount_usd), 0)::float8 AS ledger_total_usd,
           MIN(effective_date)::text AS anchored_at
         FROM pipeline.credit_ledger`,
      );
      const budget = ledger?.anchored_at
        ? await remainingBudget(
            pool,
            ledger.anchored_at,
            ledger.ledger_total_usd,
          )
        : null;

      return h.response({
        budget,
        org_available: orgAvailable,
        org_mtd: orgMtd ?? {
          billed_usd: 0,
          input_tokens: 0,
          output_tokens: 0,
          as_of: null,
          billed_through: null,
        },
        org_by_model: orgByModel,
        org_daily: orgDaily,
        lore_unbilled_usd: unbilledRows[0]?.cost_usd ?? 0,
        lore_unbilled_days: unbilledRows[0]?.days ?? 0,
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
