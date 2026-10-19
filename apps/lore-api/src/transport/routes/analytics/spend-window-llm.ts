import type { Pool } from "pg";
import type { z } from "zod";
import type { SpendWindowSchema } from "./spend-window-schema.js";
import { vendorSplit } from "../../../work/analytics/vendor-split.js";
import { optionalTableRows, type SpendWindow } from "./spend-window-db.js";
import type { FloorCosts } from "./spend-window-compute.js";
import {
  TOTALS_SQL,
  BY_BLUEPRINT_SQL,
  BY_REPO_SQL,
  BY_MODEL_SQL,
  BY_KIND_SQL,
  DAILY_SQL,
  BY_TASK_TYPE_SQL,
  BY_BILLING_MODE_SQL,
} from "./spend-window-llm-sql.js";

/** The window's metered totals, prompt-cache reads and writes beside the uncached input — the response's own fields, as TOTALS_SQL names them. */
type LlmTotals = Pick<
  z.infer<typeof SpendWindowSchema>["llm"],
  | "calls"
  | "total_usd"
  | "input_tokens"
  | "output_tokens"
  | "cache_read_tokens"
  | "cache_write_tokens"
>;

/** What Lore metered itself, from pipeline.llm_calls: one total and seven cuts of it, and the billing-mode split read from the recorded column (falling back to floor attribution for pre-migration rows). */
export async function readLlmSpend(
  pool: Pool,
  win: SpendWindow,
  floor: FloorCosts | null,
) {
  const b = await llmBreakdowns(pool, win);
  const byCluster = await readByCluster(pool, win.fromTs, win.toTs);

  if (b.byBillingMode.length > 0) {
    return {
      ...b.totals,
      ...llmCuts(b),
      by_cluster: byCluster,
      by_billing_mode: b.byBillingMode,
      floor_unavailable: false,
    };
  }

  const floorModes = await floorBillingModes(floor, win);

  return {
    ...b.totals,
    ...llmCuts(b),
    by_cluster: byCluster,
    by_billing_mode: billingModeSplit(b.totals, floorModes ?? []),
    floor_unavailable: floorModes === null,
  };
}

function llmCuts(b: Awaited<ReturnType<typeof llmBreakdowns>>) {
  return {
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
  };
}

/** The floor's agent visits by the credential each ran on; nothing on a deployment that was given no floor, and null when the floor cannot answer (down, or a version without the billing_mode group), so the page still renders Lore's own share. */
async function floorBillingModes(
  floor: FloorCosts | null,
  win: SpendWindow,
): Promise<FloorBillingRow[] | null> {
  if (!floor) {
    return [];
  }

  try {
    return await floor.costs.summary(
      { since: win.fromTs, until: win.toTs },
      "billing_mode",
    );
  } catch (err) {
    console.warn(
      `[spend-window] floor billing_mode costs unavailable: ${(err as Error).message}`,
    );

    return null;
  }
}

export type BillingMode = "api_key" | "subscription" | "unknown";

interface BillingModeRow {
  mode: BillingMode;
  calls: number;
  cost_usd: number;
}

interface FloorBillingRow {
  key: string | null;
  costUsd: number;
  visits: number;
}

const BILLING_MODES: BillingMode[] = ["api_key", "subscription", "unknown"];

/** Lore's own model calls run in-process on the org's API key; agent runs happen on the floor, whose visits say which credential they ran on. A mode with nothing in it is left out. */
export function billingModeSplit(
  loreOwn: Pick<LlmTotals, "calls" | "total_usd">,
  floorRows: FloorBillingRow[],
): BillingModeRow[] {
  const rows = BILLING_MODES.map((mode) => {
    const floorRow = floorRows.find((row) => (row.key ?? "unknown") === mode);
    const own =
      mode === "api_key"
        ? { calls: Number(loreOwn.calls), cost_usd: Number(loreOwn.total_usd) }
        : { calls: 0, cost_usd: 0 };

    return {
      mode,
      calls: own.calls + (floorRow?.visits ?? 0),
      cost_usd: own.cost_usd + (floorRow?.costUsd ?? 0),
    };
  });

  return rows.filter((row) => row.calls > 0 || row.cost_usd > 0);
}

/** The seven breakdowns plus the recorded billing_mode split — they are independent reads over the same window. `by_kind` is the only view that separates code-review lines from tasks and memory jobs. */
async function llmBreakdowns(pool: Pool, win: SpendWindow) {
  const { fromTs, toTs } = win;
  const params: [string, string] = [fromTs, toTs];
  const [totals, byBlueprint, byRepo, byModel, byKind, daily, byTaskType] =
    await breakdownQueries(pool, params);
  // Migration-gated: column absent → empty rows → caller falls back to floor attribution.
  const byBillingMode = await optionalTableRows<BillingModeRow>(
    pool,
    BY_BILLING_MODE_SQL,
    params,
  );

  return {
    totals: totals.rows[0] as LlmTotals,
    byBlueprint: byBlueprint.rows,
    byRepo: byRepo.rows,
    byModel: byModel.rows,
    byKind: byKind.rows,
    daily: daily.rows,
    byTaskType: byTaskType.rows,
    byBillingMode,
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
