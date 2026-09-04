import type { Pool, QueryResultRow } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { RunningPodInfo } from "@re-cinq/lore-shared";
import { ClusterAgentClient } from "@re-cinq/lore-shared/cluster/cluster-agent-client.js";
import { apiError } from "../../../server/api-error.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { clusterAgentCredentials } from "../../../features/agents/agent-crd-k8s.js";
import { NON_ANTHROPIC_LIKE_PATTERNS } from "@re-cinq/lore-shared/llm/model-vendor.js";
import { vendorSplit } from "../../../features/analytics/vendor-split.js";
import {
  DEFAULT_POD_PROFILE,
  podHourlyUsd,
  ratesFromEnv,
  spendInterval,
} from "../../../features/analytics/compute-cost.js";

// The whole spend screen in one interval-scoped call (absorbed the old month-to-date /api/spend): metered llm_calls, billed anthropic_cost_daily, the NON-interval-scoped credit balance, and a central-cluster-only compute estimate (live pods degrade to [] if unreachable).

const UNDEFINED_TABLE = "42P01";

// A table that may not exist yet (anthropic_cost_daily, credit_ledger — migration-gated) degrades to empty rows rather than 500.
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

// remaining = ledger - (billed + computed); the two halves meet at billed_through (billed through-and-including it, computed strictly after) — an off-by-one double-counts or drops a day.
async function remainingBudget(
  pool: Pool,
  anchoredAt: string,
  ledgerTotalUsd: number,
) {
  // Whole days (Anthropic's report is day-bucketed, unsplittable); MAX(bucket_date) over the WHOLE table (not the interval), since the anchor can predate it.
  const [billed] = await optionalTableRows<{
    billed_usd: number;
    billed_through: string | null;
  }>(
    pool,
    `SELECT
       COALESCE(SUM(cost_usd)
         FILTER (WHERE bucket_date >= (($1::timestamptz) AT TIME ZONE 'UTC')::date),
         0)::float8 AS billed_usd,
       MAX(bucket_date)::text AS billed_through
     FROM pipeline.anthropic_cost_daily`,
    [anchoredAt],
  );
  // Computed spend strictly after billed_through, only Anthropic-charged calls (Gemini calls since 2026-09-02 excluded).
  const [computed] = await optionalTableRows<{ cost_usd: number }>(
    pool,
    `SELECT COALESCE(SUM(lc.cost_usd), 0)::float8 AS cost_usd
       FROM pipeline.llm_calls lc
       LEFT JOIN pipeline.station_runs sr
         ON sr.station_run_id = lc.station_run_id
      WHERE lc.created_at >= $1::timestamptz
        AND ($2::date IS NULL OR lc.created_at::date > $2::date)
        AND sr.cluster_agent_id IS NULL
        AND lc.model NOT LIKE ALL($3::text[])`,
    [
      anchoredAt,
      billed?.billed_through ?? null,
      [...NON_ANTHROPIC_LIKE_PATTERNS],
    ],
  );
  const spentSinceUsd = (billed?.billed_usd ?? 0) + (computed?.cost_usd ?? 0);

  return {
    ledger_total_usd: ledgerTotalUsd,
    spent_since_usd: spentSinceUsd,
    remaining_usd: ledgerTotalUsd - spentSinceUsd,
    anchored_at: anchoredAt,
  };
}

const LiveSchema = z.object({
  name: z.string(),
  phase: z.string(),
  started_at: z.string().nullable(),
  requests: z.record(z.string()),
  usd_per_hour: z.number(),
  usd_so_far: z.number(),
  station_run_id: z.string().nullable(),
});

// What is LEFT (no API exposes a balance, so it's whatever a person recorded in credit_ledger); null (not zero) when unmigrated/empty, same distinction billed.available draws.
const BudgetSchema = z
  .object({
    ledger_total_usd: z.number(),
    // Billed spend through billed_through plus Lore-computed spend strictly after it, summed to one number.
    spent_since_usd: z.number(),
    // Deliberately allowed to go negative: clamping at zero would hide the overrun that matters most.
    remaining_usd: z.number(),
    // The earliest ledger effective_at, as an ISO-8601 UTC instant (not a day) so a stale anchor is visible and a midday top-up isn't charged the prior morning's spend.
    anchored_at: z.string(),
  })
  .nullable();

const SpendWindowSchema = z.object({
  interval: z.object({ from: z.string(), to: z.string() }),
  llm: z.object({
    total_usd: z.number(),
    calls: z.number(),
    input_tokens: z.number(),
    output_tokens: z.number(),
    by_blueprint: z.array(
      z.object({
        blueprint: z.string(),
        runs: z.number(),
        usd: z.number(),
      }),
    ),
    by_repo: z.array(z.object({ repo: z.string(), usd: z.number() })),
    by_model: z.array(
      z.object({
        model: z.string(),
        calls: z.number(),
        cost_usd: z.number(),
        input_tokens: z.number(),
        output_tokens: z.number(),
      }),
    ),
    by_vendor: z.array(
      z.object({
        vendor: z.string(),
        calls: z.number(),
        cost_usd: z.number(),
      }),
    ),
    by_kind: z.array(
      z.object({
        kind: z.string(),
        calls: z.number(),
        cost_usd: z.number(),
      }),
    ),
    daily: z.array(
      z.object({
        bucket_date: z.string(),
        calls: z.number(),
        cost_usd: z.number(),
      }),
    ),
    by_task_type: z.array(
      z.object({
        task_type: z.string(),
        tasks: z.number(),
        cost_usd: z.number(),
      }),
    ),
    // Spend by execution cluster (via llm_calls.station_run_id -> station_runs.cluster_agent_id); cluster is NULL (not a sentinel string) for no-cluster calls since a real cluster IS named "central".
    by_cluster: z.array(
      z.object({
        cluster: z.string().nullable(),
        calls: z.number(),
        cost_usd: z.number(),
      }),
    ),
  }),
  // Anthropic's own billing, interval-scoped, reported beside (never reconciled with) the computed figures; available=false when no admin key has ever synced, rows empty either way.
  billed: z.object({
    available: z.boolean(),
    total_usd: z.number(),
    input_tokens: z.number(),
    output_tokens: z.number(),
    as_of: z.string().nullable(),
    // Last day Anthropic has actually billed — MAX(bucket_date) over the WHOLE table, not "yesterday"; distinguishes a late/failed sync from a current one (as_of answers a different question).
    billed_through: z.string().nullable(),
    by_model: z.array(
      z.object({
        model: z.string(),
        cost_usd: z.number(),
        input_tokens: z.number(),
        output_tokens: z.number(),
      }),
    ),
    daily: z.array(z.object({ bucket_date: z.string(), cost_usd: z.number() })),
    // Lore-computed spend (and day count) past billed_through — brings the billed figure current without folding a computed number into an authoritative one.
    unbilled_usd: z.number(),
    unbilled_days: z.number(),
  }),
  budget: BudgetSchema,
  // Google's own billing (gcp_cost_daily, via gcp-cost-sync + Cloud Billing export); authoritative counterpart to the compute ESTIMATE below, reported beside it, net of credits.
  gcp: z.object({
    available: z.boolean(),
    total_usd: z.number(),
    as_of: z.string().nullable(),
    // Last day the export has actually closed — MAX(bucket_date) over the whole table, since Google's export lags a day or more.
    billed_through: z.string().nullable(),
    by_service: z.array(
      z.object({ service: z.string(), cost_usd: z.number() }),
    ),
    daily: z.array(z.object({ bucket_date: z.string(), cost_usd: z.number() })),
  }),
  compute: z.object({
    rates: z.object({
      cpu_hour_usd: z.number(),
      mem_gib_hour_usd: z.number(),
    }),
    assumed_profile: z.record(z.string()),
    pod_hours: z.array(
      z.object({
        blueprint: z.string(),
        pods: z.number(),
        hours: z.number(),
        est_usd: z.number(),
      }),
    ),
    est_total_usd: z.number(),
    live_pods: z.array(LiveSchema),
    live_usd_per_hour: z.number(),
  }),
});

export interface SpendWindowDeps {
  /** The central cluster's running pods; [] when the agent is unreachable. */
  livePods(): Promise<RunningPodInfo[]>;
  env: NodeJS.ProcessEnv;
  now(): Date;
}

const defaultDeps = (): SpendWindowDeps => ({
  livePods: async () => {
    const { baseUrl, token } = clusterAgentCredentials(process.env);

    if (!baseUrl) {
      return [];
    }

    try {
      const body = await new ClusterAgentClient(baseUrl, token).call<{
        pods: RunningPodInfo[];
      }>("GET", "/pods");

      return body?.pods ?? [];
    } catch {
      return [];
    }
  },
  env: process.env,
  now: () => new Date(),
});

export function spendWindowRoute(
  getPool: () => Pool | null,
  deps: SpendWindowDeps = defaultDeps(),
): ServerRoute {
  return {
    method: "GET",
    path: "/api/analytics/spend-window",
    options: zodResponse(bearerScope("read"), SpendWindowSchema, {
      name: "SpendWindow",
      description:
        "The spend screen in one interval-scoped call: metered and billed LLM spend, their breakdowns, the recorded balance, and the estimated Kubernetes compute cost",
      errors: [400],
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const q = request.query as Record<string, string | undefined>;
      let interval: { from: string; to: string };

      try {
        interval = spendInterval(q.from, q.to, deps.now());
      } catch (err) {
        throw apiError(400)((err as Error).message);
      }
      // Inclusive day bounds: [from 00:00, to + 1 day).
      const win: SpendWindow = {
        interval,
        fromTs: `${interval.from}T00:00:00Z`,
        toTs: new Date(
          Date.parse(`${interval.to}T00:00:00Z`) + 24 * 60 * 60 * 1000,
        ).toISOString(),
      };

      return h
        .response({
          interval,
          llm: await readLlmSpend(pool, win),
          billed: await readAnthropicSpend(pool, win),
          gcp: await readGcpSpend(pool, win),
          compute: await readComputeSpend(pool, win, deps),
          budget: await readBudget(pool),
        })
        .code(200);
    },
  };
}

/** One interval, in both the shapes the reads below need: the day pair the billing tables are keyed by, and the timestamp bounds the per-call tables are. */
interface SpendWindow {
  interval: { from: string; to: string };
  fromTs: string;
  toTs: string;
}

/** What Lore metered itself, from pipeline.llm_calls: one total and seven cuts of it. */
async function readLlmSpend(pool: Pool, win: SpendWindow) {
  const { fromTs, toTs } = win;

  const { rows: totals } = await pool.query(
    `SELECT count(*)::int AS calls, coalesce(sum(cost_usd), 0)::float AS usd,
            coalesce(sum(input_tokens), 0)::float AS input_tokens,
            coalesce(sum(output_tokens), 0)::float AS output_tokens
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2`,
    [fromTs, toTs],
  );
  const { rows: byBlueprint } = await pool.query(
    `SELECT ar.blueprint_name AS blueprint,
            count(DISTINCT ar.id)::int AS runs,
            coalesce(sum(l.cost_usd), 0)::float AS usd
       FROM pipeline.llm_calls l
       JOIN pipeline.assembly_runs ar ON ar.id = l.assembly_line_id
      WHERE l.created_at >= $1 AND l.created_at < $2
      GROUP BY 1 ORDER BY 3 DESC`,
    [fromTs, toTs],
  );
  const { rows: byRepo } = await pool.query(
    `SELECT ar.repo, coalesce(sum(l.cost_usd), 0)::float AS usd
       FROM pipeline.llm_calls l
       JOIN pipeline.assembly_runs ar ON ar.id = l.assembly_line_id
      WHERE l.created_at >= $1 AND l.created_at < $2
      GROUP BY 1 ORDER BY 2 DESC`,
    [fromTs, toTs],
  );
  const { rows: byModel } = await pool.query(
    `SELECT model, COUNT(*)::int AS calls, SUM(cost_usd)::float8 AS cost_usd,
            SUM(input_tokens)::float8 AS input_tokens,
            SUM(output_tokens)::float8 AS output_tokens
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY model ORDER BY cost_usd DESC`,
    [fromTs, toTs],
  );
  // The only view that separates code-review lines (task-less) from tasks from the memory/curation jobs.
  const { rows: byKind } = await pool.query(
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
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1 ORDER BY cost_usd DESC`,
    [fromTs, toTs],
  );
  const { rows: daily } = await pool.query(
    `SELECT created_at::date::text AS bucket_date, COUNT(*)::int AS calls,
            SUM(cost_usd)::float8 AS cost_usd
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1 ORDER BY 1 DESC`,
    [fromTs, toTs],
  );
  const { rows: byTaskType } = await pool.query(
    `SELECT t.task_type, COUNT(DISTINCT t.id)::int AS tasks,
            SUM(lc.cost_usd)::float8 AS cost_usd
       FROM pipeline.llm_calls lc JOIN pipeline.tasks t ON t.id = lc.task_id
      WHERE lc.created_at >= $1 AND lc.created_at < $2
      GROUP BY t.task_type ORDER BY cost_usd DESC`,
    [fromTs, toTs],
  );
  // LEFT JOINs on purpose: a direct-API call has no cluster_agent_id and must land in the null bucket, not be dropped by an inner join; optionalTableRows since station_runs/cluster_agents are migration-gated.
  const byCluster = await optionalTableRows<{
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

interface BilledAnthropicTotals {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  asOf: string | null;
  billedThrough: string | null;
  available: boolean;
}

// `as_of`, not a row count, distinguishes "synced and owes nothing" from "never synced" — the view hides billed sections for the latter rather than showing a confident zero.
async function readBilledAnthropicTotals(
  pool: Pool,
  interval: SpendWindow["interval"],
): Promise<BilledAnthropicTotals> {
  const billedTotalRows = await optionalTableRows<{
    billed_usd: number;
    input_tokens: number;
    output_tokens: number;
    as_of: string | null;
    billed_through: string | null;
  }>(
    pool,
    `SELECT
       COALESCE(SUM(cost_usd)
         FILTER (WHERE bucket_date >= $1::date AND bucket_date <= $2::date),
         0)::float8 AS billed_usd,
       COALESCE(SUM(input_tokens)
         FILTER (WHERE bucket_date >= $1::date AND bucket_date <= $2::date),
         0)::float8 AS input_tokens,
       COALESCE(SUM(output_tokens)
         FILTER (WHERE bucket_date >= $1::date AND bucket_date <= $2::date),
         0)::float8 AS output_tokens,
       MAX(fetched_at) AS as_of,
       MAX(bucket_date)::text AS billed_through
     FROM pipeline.anthropic_cost_daily`,
    [interval.from, interval.to],
  );
  const billedTotal = billedTotalRows[0];

  return {
    totalUsd: billedTotal?.billed_usd ?? 0,
    inputTokens: billedTotal?.input_tokens ?? 0,
    outputTokens: billedTotal?.output_tokens ?? 0,
    asOf: billedTotal?.as_of ?? null,
    billedThrough: billedTotal?.billed_through ?? null,
    available: Boolean(billedTotal?.as_of),
  };
}

interface UnbilledAnthropicSpend {
  costUsd: number;
  days: number;
}

// Every interval day Anthropic has not billed yet; `billedThrough` is passed as a param (not joined in) so an absent anthropic_cost_daily can't take this sync-independent half down too.
async function readUnbilledAnthropicSpend(
  pool: Pool,
  win: SpendWindow,
  billedThrough: string | null,
): Promise<UnbilledAnthropicSpend> {
  const { rows } = await pool.query<{
    cost_usd: number;
    days: number;
  }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd,
            COUNT(DISTINCT created_at::date)::int AS days
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2
        AND ($3::date IS NULL OR created_at::date > $3::date)
        AND model NOT LIKE ALL($4::text[])`,
    [win.fromTs, win.toTs, billedThrough, [...NON_ANTHROPIC_LIKE_PATTERNS]],
  );
  const row = rows[0];

  return { costUsd: row?.cost_usd ?? 0, days: row?.days ?? 0 };
}

/** What Anthropic actually billed, plus the metered days it has not billed yet. */
async function readAnthropicSpend(pool: Pool, win: SpendWindow) {
  const { interval } = win;
  const totals = await readBilledAnthropicTotals(pool, interval);
  const billedByModel = await optionalTableRows(
    pool,
    `SELECT model, SUM(cost_usd)::float8 AS cost_usd,
            SUM(input_tokens)::float8 AS input_tokens,
            SUM(output_tokens)::float8 AS output_tokens
       FROM pipeline.anthropic_cost_daily
      WHERE bucket_date >= $1::date AND bucket_date <= $2::date
      GROUP BY model ORDER BY cost_usd DESC`,
    [interval.from, interval.to],
  );
  const billedDaily = await optionalTableRows(
    pool,
    `SELECT bucket_date::text AS bucket_date, SUM(cost_usd)::float8 AS cost_usd
       FROM pipeline.anthropic_cost_daily
      WHERE bucket_date >= $1::date AND bucket_date <= $2::date
      GROUP BY bucket_date ORDER BY bucket_date DESC`,
    [interval.from, interval.to],
  );
  const unbilled = await readUnbilledAnthropicSpend(
    pool,
    win,
    totals.billedThrough,
  );

  return {
    available: totals.available,
    total_usd: totals.totalUsd,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    as_of: totals.asOf,
    billed_through: totals.billedThrough,
    by_model: billedByModel,
    daily: billedDaily,
    unbilled_usd: unbilled.costUsd,
    unbilled_days: unbilled.days,
  };
}

/** What GCP billed for the cluster the platform runs on. */
async function readGcpSpend(pool: Pool, win: SpendWindow) {
  const { interval } = win;

  // Same rules as the Anthropic reads (interval-filtered totals, whole-table stamps, optionalTableRows for the migration+export lag); cost is gross+credits, summed to the invoice's net.
  const gcpTotalRows = await optionalTableRows<{
    billed_usd: number;
    as_of: string | null;
    billed_through: string | null;
  }>(
    pool,
    `SELECT
       COALESCE(SUM(cost_usd + credits_usd)
         FILTER (WHERE bucket_date >= $1::date AND bucket_date <= $2::date),
         0)::float8 AS billed_usd,
       MAX(fetched_at) AS as_of,
       MAX(bucket_date)::text AS billed_through
     FROM pipeline.gcp_cost_daily`,
    [interval.from, interval.to],
  );
  const gcpByService = await optionalTableRows(
    pool,
    `SELECT service, SUM(cost_usd + credits_usd)::float8 AS cost_usd
       FROM pipeline.gcp_cost_daily
      WHERE bucket_date >= $1::date AND bucket_date <= $2::date
      GROUP BY service ORDER BY cost_usd DESC`,
    [interval.from, interval.to],
  );
  const gcpDaily = await optionalTableRows(
    pool,
    `SELECT bucket_date::text AS bucket_date,
            SUM(cost_usd + credits_usd)::float8 AS cost_usd
       FROM pipeline.gcp_cost_daily
      WHERE bucket_date >= $1::date AND bucket_date <= $2::date
      GROUP BY bucket_date ORDER BY bucket_date DESC`,
    [interval.from, interval.to],
  );
  const gcpTotal = gcpTotalRows[0];

  return {
    // Same as_of rule as the Anthropic half: distinguishes "synced and spent nothing" from "never synced".
    available: !!gcpTotal?.as_of,
    total_usd: gcpTotal?.billed_usd ?? 0,
    as_of: gcpTotal?.as_of ?? null,
    billed_through: gcpTotal?.billed_through ?? null,
    by_service: gcpByService,
    daily: gcpDaily,
  };
}

/** Estimated pod cost: hours already burned in the interval, priced at the assumed profile, plus what the live pods are spending right now. */
async function readComputeSpend(
  pool: Pool,
  win: SpendWindow,
  deps: SpendWindowDeps,
) {
  const { fromTs, toTs } = win;

  // Rows whose run overlaps the interval, clipped to it; only Agent-CR rows are pods. An open finished_at is capped at started_at+2h (the reaper's ceiling) — uncapped, 177 comment-triage pods once billed 8,606 pod-hours from unrecorded deaths.
  const { rows: podHours } = await pool.query(
    `SELECT ar.blueprint_name AS blueprint,
            count(*)::int AS pods,
            coalesce(sum(
              extract(epoch FROM
                least(
                  coalesce(sr.finished_at,
                           least(now(), sr.started_at + interval '2 hours')),
                  $2::timestamptz)
                - greatest(sr.started_at, $1::timestamptz)
              )
            ) / 3600.0, 0)::float AS hours
       FROM pipeline.station_runs sr
       JOIN pipeline.assembly_runs ar ON ar.id = sr.assembly_run_id
      WHERE sr.agent_cr_name IS NOT NULL
        AND sr.started_at < $2
        AND coalesce(sr.finished_at,
                     least(now(), sr.started_at + interval '2 hours')) > $1
      GROUP BY 1 ORDER BY 3 DESC`,
    [fromTs, toTs],
  );
  const rates = ratesFromEnv(deps.env);
  const profileRate = podHourlyUsd(DEFAULT_POD_PROFILE, rates);
  const podHourRows = (
    podHours as Array<{ blueprint: string; pods: number; hours: number }>
  ).map((row) => ({
    ...row,
    hours: Math.round(row.hours * 100) / 100,
    est_usd: Math.round(row.hours * profileRate * 100) / 100,
  }));

  const nowMs = deps.now().getTime();
  // A live-read failure yields an empty list — the metered numbers must render regardless of the cluster.
  const livePods = await deps.livePods().catch(() => []);
  const live = livePods.map((pod) => {
    const usdPerHour = podHourlyUsd(pod.requests, rates);
    const hours = pod.startedAt
      ? Math.max(0, nowMs - Date.parse(pod.startedAt)) / 3_600_000
      : 0;

    return {
      name: pod.name,
      phase: pod.phase,
      started_at: pod.startedAt,
      requests: pod.requests,
      usd_per_hour: Math.round(usdPerHour * 10000) / 10000,
      usd_so_far: Math.round(usdPerHour * hours * 10000) / 10000,
      station_run_id: pod.labels["lore.re-cinq.com/station-run-id"] ?? null,
    };
  });

  return {
    rates: {
      cpu_hour_usd: rates.cpuHourUsd,
      mem_gib_hour_usd: rates.memGibHourUsd,
    },
    assumed_profile: DEFAULT_POD_PROFILE,
    pod_hours: podHourRows,
    est_total_usd:
      Math.round(podHourRows.reduce((sum, r) => sum + r.est_usd, 0) * 100) /
      100,
    live_pods: live,
    live_usd_per_hour:
      Math.round(live.reduce((sum, p) => sum + p.usd_per_hour, 0) * 10000) /
      10000,
  };
}

/** The recorded balance, which is NOT interval-scoped: a ledger is a running total, and clipping it to a window would report a balance the account never had. */
async function readBudget(pool: Pool) {
  // Read last, so no other read's statement ordering shifts; an empty ledger yields anchored_at null (no anchor, no arithmetic, no budget).
  const [ledger] = await optionalTableRows<{
    ledger_total_usd: number;
    anchored_at: string | null;
  }>(
    pool,
    // Anchor = the OPENING entry (not MIN over everything — a backdated top-up must not drag the window back), falling back to earliest non-correction; corrections are excluded from the anchor but not the total; rendered as an explicit ISO-8601 UTC string since a pg Date doesn't survive the wire+RSC boundary.
    `SELECT COALESCE(SUM(amount_usd), 0)::float8 AS ledger_total_usd,
       to_char(
         COALESCE(
           MIN(effective_at) FILTER (WHERE kind = 'opening'),
           MIN(effective_at) FILTER (WHERE kind <> 'correction')
         ) AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS anchored_at
     FROM pipeline.credit_ledger`,
  );
  const budget = ledger?.anchored_at
    ? await remainingBudget(pool, ledger.anchored_at, ledger.ledger_total_usd)
    : null;

  return budget;
}
