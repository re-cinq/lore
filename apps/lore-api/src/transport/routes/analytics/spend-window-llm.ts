import type { Pool } from "pg";
import { vendorSplit } from "../../../work/analytics/vendor-split.js";
import { optionalTableRows, type SpendWindow } from "./spend-window-db.js";
import {
  TOTALS_SQL,
  BY_BLUEPRINT_SQL,
  BY_REPO_SQL,
  BY_MODEL_SQL,
  BY_KIND_SQL,
  DAILY_SQL,
  BY_TASK_TYPE_SQL,
} from "./spend-window-llm-sql.js";

/** LEFT JOINs on purpose: a direct-API call has no cluster_agent_id and must land in the null bucket, not be dropped by an inner join; optionalTableRows since station_runs/cluster_agents are migration-gated. */
async function readByCluster(pool: Pool, fromTs: string, toTs: string) {
  return optionalTableRows<{
    cluster: string | null;
    calls: number;
    cost_usd: number;
  }>(
    pool,
    `SELECT ca.name AS cluster,
            COUNT(*)::int AS calls, SUM(lc.cost_usd)::float8 AS cost_usd
       FROM pipeline.llm_calls lc
       LEFT JOIN pipeline.station_runs sr
         ON sr.station_run_id = lc.station_run_id
       LEFT JOIN pipeline.cluster_agents ca ON ca.id = sr.cluster_agent_id
      WHERE lc.created_at >= $1 AND lc.created_at < $2
      GROUP BY ca.name ORDER BY cost_usd DESC`,
    [fromTs, toTs],
  );
}

/** The seven breakdowns, run together — they are independent reads over the same window, and doing them in sequence made the spend page's slowest query seven times over. `by_kind` is the only view that separates code-review lines (which carry no task) from tasks and from the memory jobs. */
async function llmBreakdowns(pool: Pool, win: SpendWindow) {
  const { fromTs, toTs } = win;
  const [totals, byBlueprint, byRepo, byModel, byKind, daily, byTaskType] =
    await breakdownQueries(pool, [fromTs, toTs]);

  return {
    totals: totals.rows[0] as {
      calls: number;
      usd: number;
      input_tokens: number;
      output_tokens: number;
    },
    byBlueprint: byBlueprint.rows,
    byRepo: byRepo.rows,
    byModel: byModel.rows,
    byKind: byKind.rows,
    daily: daily.rows,
    byTaskType: byTaskType.rows,
  };
}

function breakdownQueries(pool: Pool, params: [string, string]) {
  return Promise.all([
    pool.query(TOTALS_SQL, params),
    pool.query(BY_BLUEPRINT_SQL, params),
    pool.query(BY_REPO_SQL, params),
    pool.query(BY_MODEL_SQL, params),
    pool.query(BY_KIND_SQL, params),
    pool.query(DAILY_SQL, params),
    pool.query(BY_TASK_TYPE_SQL, params),
  ]);
}

/** What Lore metered itself, from pipeline.llm_calls: one total and seven cuts of it. */
export async function readLlmSpend(pool: Pool, win: SpendWindow) {
  const b = await llmBreakdowns(pool, win);

  return {
    total_usd: b.totals.usd,
    calls: b.totals.calls,
    input_tokens: b.totals.input_tokens,
    output_tokens: b.totals.output_tokens,
    by_blueprint: b.byBlueprint,
    by_repo: b.byRepo,
    by_model: b.byModel,
    // Derived from the model split rather than queried: a vendor is a property of the model name, and a second query could disagree with the first.
    by_vendor: vendorSplit(
      b.byModel as Array<{ model: string; calls: number; cost_usd: number }>,
    ),
    by_kind: b.byKind,
    daily: b.daily,
    by_task_type: b.byTaskType,
    by_cluster: await readByCluster(pool, win.fromTs, win.toTs),
  };
}
