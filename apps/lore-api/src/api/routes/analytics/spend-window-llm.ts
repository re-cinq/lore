import type { Pool } from "pg";
import { vendorSplit } from "../../../features/analytics/vendor-split.js";
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

/** What Lore metered itself, from pipeline.llm_calls: one total and seven cuts of it. */
export async function readLlmSpend(pool: Pool, win: SpendWindow) {
  const { fromTs, toTs } = win;

  const { rows: totals } = await pool.query(TOTALS_SQL, [fromTs, toTs]);
  const { rows: byBlueprint } = await pool.query(BY_BLUEPRINT_SQL, [
    fromTs,
    toTs,
  ]);
  const { rows: byRepo } = await pool.query(BY_REPO_SQL, [fromTs, toTs]);
  const { rows: byModel } = await pool.query(BY_MODEL_SQL, [fromTs, toTs]);
  // The only view that separates code-review lines (task-less) from tasks from the memory/curation jobs.
  const { rows: byKind } = await pool.query(BY_KIND_SQL, [fromTs, toTs]);
  const { rows: daily } = await pool.query(DAILY_SQL, [fromTs, toTs]);
  const { rows: byTaskType } = await pool.query(BY_TASK_TYPE_SQL, [
    fromTs,
    toTs,
  ]);
  const byCluster = await readByCluster(pool, fromTs, toTs);

  const llmTotals = totals[0] as {
    calls: number;
    usd: number;
    input_tokens: number;
    output_tokens: number;
  };

  return {
    total_usd: llmTotals.usd,
    calls: llmTotals.calls,
    input_tokens: llmTotals.input_tokens,
    output_tokens: llmTotals.output_tokens,
    by_blueprint: byBlueprint,
    by_repo: byRepo,
    by_model: byModel,
    by_vendor: vendorSplit(
      byModel as Array<{ model: string; calls: number; cost_usd: number }>,
    ),
    by_kind: byKind,
    daily,
    by_task_type: byTaskType,
    by_cluster: byCluster,
  };
}
