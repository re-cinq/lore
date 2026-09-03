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
import {
  DEFAULT_POD_PROFILE,
  podHourlyUsd,
  ratesFromEnv,
  spendInterval,
} from "../../../features/analytics/compute-cost.js";

/**
 * GET /api/analytics/spend-window?from&to — the whole spend screen in one
 * call, every aggregate scoped to the selected interval (the page has no other
 * scope — the old month-to-date `/api/spend` sections merged into this view):
 *
 * - metered LLM spend from `pipeline.llm_calls` (realtime — the agent-events
 *   sink writes cost rows within seconds of each model call), with its
 *   by-model / by-kind / daily / by-repo / by-task-type / by-cluster
 *   breakdowns;
 * - Anthropic's authoritative BILLED cost from `pipeline.anthropic_cost_daily`
 *   (written once a day by the cost-sync cron; absent without an admin key),
 *   plus the Lore-computed remainder for interval days the sync has not
 *   billed yet;
 * - the recorded credit balance — the ONE figure that is not interval-scoped.
 *   A balance added in June is still money in August, so clipping its window
 *   to the interval would silently forgive every dollar spent outside it;
 * - the Kubernetes compute ESTIMATE, both halves of it: historical
 *   station-run pod-hours in the interval × an assumed pod profile
 *   (`station_runs` records when each pod ran, not how big it was, so the
 *   response names the profile and rates it assumed), and the running pods
 *   right now, each priced from its ACTUAL resource requests, read through
 *   the central cluster-agent. A satellite's pods are not in this view, and
 *   an unreachable cluster-agent degrades to an empty live list rather than
 *   failing the page.
 *
 * The interval bounds the METERED and BILLED reads; the live list is by
 * nature "now".
 */

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
  // Whole days, because Anthropic's cost report is day-bucketed and cannot be
  // split: an anchor at 14:30 on an already-billed day still charges that
  // whole day. Unavoidable, and it does not touch the case that matters —
  // the report never emits the day in progress, so an entry recorded today is
  // never in here at all.
  //
  // MAX(bucket_date) over the WHOLE table, not the interval: the anchor can
  // predate it, and a window whose sync has not run yet would otherwise
  // report no billed day at all and shove every dollar onto the computed side.
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
  // Here is the precision. `created_at >= $1::timestamptz` compares MOMENTS,
  // not days, so a midday top-up on a healthy balance is not charged the
  // morning's spend — the money was added at 14:30 and the spend before then
  // came out of the balance it replaced. Day-granularity got this wrong by up
  // to a full day, and always in the direction of understating what is left.
  //
  // The bound rides in as a parameter rather than a subquery, for the reason
  // the unbilled read already gives: `anthropic_cost_daily` is absent on
  // clusters with no admin key, and a subquery against it would take the
  // Lore-computed half down with it.
  // Only spend that DREW these credits belongs in the balance. A call claimed
  // by a registered satellite cluster ran on that cluster's own credential (a
  // colleague's subscription), so its cost never touched this account — it is
  // in `llm_calls` because Lore prices every call it sees, but it is not in the
  // billed report and must not be in the balance either, or the card goes
  // negative on money the account never spent. The LEFT JOIN keeps calls with
  // no station run (direct API tasks) and home/central runs (null claim); it
  // drops only satellite-attributed ones.
  const [computed] = await optionalTableRows<{ cost_usd: number }>(
    pool,
    `SELECT COALESCE(SUM(lc.cost_usd), 0)::float8 AS cost_usd
       FROM pipeline.llm_calls lc
       LEFT JOIN pipeline.station_runs sr
         ON sr.station_run_id = lc.station_run_id
      WHERE lc.created_at >= $1::timestamptz
        AND ($2::date IS NULL OR lc.created_at::date > $2::date)
        AND sr.cluster_agent_id IS NULL`,
    [anchoredAt, billed?.billed_through ?? null],
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

/**
 * What is LEFT, which no API can tell us. Anthropic's Admin API exposes usage
 * and cost reports and no credit balance, so the balance is whatever a person
 * has recorded in `pipeline.credit_ledger` — and `remaining` is that total
 * minus everything spent since the earliest entry.
 *
 * Null, not zero, when the ledger is empty or its table has not been migrated
 * yet: the same distinction `billed.available` draws. Nobody having told us
 * the balance is a different fact from the balance being nothing, and only
 * one of them should render as a number.
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
    /**
     * The earliest `effective_at` in the ledger, as an ISO-8601 UTC instant —
     * the MOMENT the arithmetic starts, shown so a stale anchor is visible
     * rather than merely wrong.
     *
     * A moment and not a day, because a top-up recorded at 14:30 onto a
     * healthy balance must not be charged that morning's spend: the money
     * before it came out of the balance this one replaced. Precision reaches
     * only as far as the sources allow — `llm_calls` timestamps every call,
     * while Anthropic's billed days cannot be split — but the report never
     * emits the day in progress, so an entry recorded today always lands in
     * the half that can be sliced exactly.
     */
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
    /**
     * Computed spend attributed to the execution cluster that ran each call —
     * the one figure on this page that separates a satellite cluster's burn
     * from the home cluster's. A call reaches its cluster through the station
     * run it belongs to (`llm_calls.station_run_id` →
     * `station_runs.cluster_agent_id`), so a direct-API call with no station
     * run carries no cluster.
     *
     * `cluster` is NULL for that no-cluster bucket rather than a sentinel
     * string: a real cluster can be named anything (there IS one registered
     * `central`), so a label like `(central / regular)` collides with it. Null
     * is the honest "no cluster-agent claim", and the view owns the label and
     * the grouping.
     */
    by_cluster: z.array(
      z.object({
        cluster: z.string().nullable(),
        calls: z.number(),
        cost_usd: z.number(),
      }),
    ),
  }),
  /**
   * Anthropic's own billing, interval-scoped, reported beside the computed
   * figures rather than reconciled with them — only one of the two is
   * authoritative. `available` is false when no admin key has ever synced,
   * and the rows are empty rather than absent, so a caller reads the same
   * shape either way.
   */
  billed: z.object({
    available: z.boolean(),
    total_usd: z.number(),
    input_tokens: z.number(),
    output_tokens: z.number(),
    as_of: z.string().nullable(),
    /**
     * The last day Anthropic has actually billed — `MAX(bucket_date)` over the
     * WHOLE table, NOT "yesterday" and not the interval's edge. The cost
     * report omits the in-progress day, so a current sync does end at
     * yesterday; a late or failed one ends earlier, and only this stamp
     * distinguishes the two. `as_of` records when the sync ran, which is a
     * different question and cannot answer this one.
     */
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
    /** Lore-computed spend for the interval days past `billed_through`, and
     *  how many days that is — what brings the billed figure current without
     *  folding a computed number into an authoritative one. */
    unbilled_usd: z.number(),
    unbilled_days: z.number(),
  }),
  budget: BudgetSchema,
  /**
   * Google's own billing, interval-scoped, from `pipeline.gcp_cost_daily`
   * (written daily by the gcp-cost-sync station reading the Cloud Billing
   * BigQuery export). The authoritative counterpart to the compute ESTIMATE
   * below — reported beside it, never reconciled with it, for the same
   * reason the Anthropic billed figures sit beside the metered ones. Costs
   * are net of credits: the invoice total, not the list price.
   */
  gcp: z.object({
    available: z.boolean(),
    total_usd: z.number(),
    as_of: z.string().nullable(),
    /** The last day the export has actually closed — `MAX(bucket_date)` over
     *  the whole table, since Google's export lags a day or more. */
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
      const fromTs = `${interval.from}T00:00:00Z`;
      const toTs = new Date(
        Date.parse(`${interval.to}T00:00:00Z`) + 24 * 60 * 60 * 1000,
      ).toISOString();

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
      // The only view that separates code-review lines (task-less) from tasks
      // from the memory/curation jobs.
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
      // Which cluster ran the call, via the station run it belongs to. Outer
      // joins on purpose: a call with no station run (a direct-API task) has no
      // cluster_agent_id, and an inner join would silently drop it instead of
      // gathering it under the null (no-cluster) bucket.
      // `optionalTableRows` because station_runs / cluster_agents arrive with
      // migrations — a deployment predating them renders empty, not a 500.
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

      // Billed totals are FILTERed to the interval while the two stamps read
      // the whole table: `billed_through` bounds the unbilled arithmetic and
      // `as_of` says whether the sync has ever run — clipping either to the
      // interval would misreport both on any window that predates the sync.
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

      // `as_of`, not a row count: an empty window reads as zero cost either
      // way, but only the stamp distinguishes "the sync has run and we owe
      // nothing" from "nothing has ever synced", and the view hides the billed
      // sections for the second rather than showing a confident zero.
      const billedTotal = billedTotalRows[0];
      const billedAvailable = !!billedTotal?.as_of;

      // Every interval day Anthropic has not billed yet. The bound is passed
      // as a parameter rather than joined in: `anthropic_cost_daily` is absent
      // on clusters with no admin key, and a subquery against it would take
      // the Lore-computed side down with it — the one half that never depended
      // on the sync.
      const { rows: unbilledRows } = await pool.query<{
        cost_usd: number;
        days: number;
      }>(
        `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd,
                COUNT(DISTINCT created_at::date)::int AS days
           FROM pipeline.llm_calls
          WHERE created_at >= $1 AND created_at < $2
            AND ($3::date IS NULL OR created_at::date > $3::date)`,
        [fromTs, toTs, billedTotal?.billed_through ?? null],
      );

      // GCP billed figures under the same rules as the Anthropic ones: totals
      // FILTERed to the interval, the two stamps over the whole table, and
      // `optionalTableRows` because both the migration and the console-side
      // billing export arrive on their own schedules. Cost is stored gross
      // with credits beside it; everything reported here is their sum — the
      // net the invoice actually charges.
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

      // Pod-hours: rows whose run overlaps the interval, clipped to it. Only
      // rows that named an Agent CR were pods; service-node rows cost nothing.
      // A row with no finished_at is NOT treated as still running: stale rows
      // whose pod died unrecorded would each bill the whole window (177
      // comment-triage pods once claimed 8,606 pod-hours this way). No pod
      // outlives the reaper by more than the 2h ceiling, so an open row is
      // capped at started_at + 2h.
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

      // Read last, so the statement ordering every other read already depends
      // on stays exactly as it was. An empty ledger yields one row whose
      // `anchored_at` is null — no anchor, no arithmetic, no budget.
      const [ledger] = await optionalTableRows<{
        ledger_total_usd: number;
        anchored_at: string | null;
      }>(
        pool,
        // Corrections are excluded from the anchor but NOT from the total.
        // A correction adjusts an amount; it does not start a balance. Left in
        // the MIN, one backdated typo fix drags the anchor back to its date
        // and counts every dollar spent in between against the balance —
        // silently, and the resulting figure looks entirely plausible.
        // Rendered to an explicit ISO-8601 UTC string rather than handed back
        // as a pg Date: this crosses a wire and then an RSC boundary, and a
        // Date does not survive that intact.
        // The anchor is the OPENING entry, not merely the earliest one. Only
        // an opening declares "the balance was this much, then" — top-ups and
        // corrections adjust the total and say nothing about when counting
        // starts. Anchoring on MIN over everything let a backdated top-up drag
        // the window weeks earlier and charge old spend against a new balance,
        // silently and plausibly. Falls back to the earliest non-correction so
        // a ledger of pure top-ups still anchors somewhere.
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
        ? await remainingBudget(
            pool,
            ledger.anchored_at,
            ledger.ledger_total_usd,
          )
        : null;

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
      // Belt to the default deps' braces: a live-read failure yields an empty
      // list — the metered numbers must render regardless of the cluster.
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

      const llmTotals = totals[0] as {
        calls: number;
        usd: number;
        input_tokens: number;
        output_tokens: number;
      };

      return h
        .response({
          interval,
          llm: {
            total_usd: llmTotals.usd,
            calls: llmTotals.calls,
            input_tokens: llmTotals.input_tokens,
            output_tokens: llmTotals.output_tokens,
            by_blueprint: byBlueprint,
            by_repo: byRepo,
            by_model: byModel,
            by_kind: byKind,
            daily,
            by_task_type: byTaskType,
            by_cluster: byCluster,
          },
          billed: {
            available: billedAvailable,
            total_usd: billedTotal?.billed_usd ?? 0,
            input_tokens: billedTotal?.input_tokens ?? 0,
            output_tokens: billedTotal?.output_tokens ?? 0,
            as_of: billedTotal?.as_of ?? null,
            billed_through: billedTotal?.billed_through ?? null,
            by_model: billedByModel,
            daily: billedDaily,
            unbilled_usd: unbilledRows[0]?.cost_usd ?? 0,
            unbilled_days: unbilledRows[0]?.days ?? 0,
          },
          budget,
          gcp: {
            // The same `as_of` rule the Anthropic half uses: only the stamp
            // distinguishes "synced and spent nothing" from "never synced".
            available: !!gcpTotal?.as_of,
            total_usd: gcpTotal?.billed_usd ?? 0,
            as_of: gcpTotal?.as_of ?? null,
            billed_through: gcpTotal?.billed_through ?? null,
            by_service: gcpByService,
            daily: gcpDaily,
          },
          compute: {
            rates: {
              cpu_hour_usd: rates.cpuHourUsd,
              mem_gib_hour_usd: rates.memGibHourUsd,
            },
            assumed_profile: DEFAULT_POD_PROFILE,
            pod_hours: podHourRows,
            est_total_usd:
              Math.round(
                podHourRows.reduce((sum, r) => sum + r.est_usd, 0) * 100,
              ) / 100,
            live_pods: live,
            live_usd_per_hour:
              Math.round(
                live.reduce((sum, p) => sum + p.usd_per_hour, 0) * 10000,
              ) / 10000,
          },
        })
        .code(200);
    },
  };
}
