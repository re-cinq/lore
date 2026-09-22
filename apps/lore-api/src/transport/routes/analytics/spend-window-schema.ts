import { z } from "zod";

/** One ticket or PR, named and linked to its Issue or pull request (null when only a description names it). */
const CostUnitSchema = z.object({
  label: z.string(),
  url: z.string().nullable(),
  runs: z.number(),
  cost_usd: z.number(),
});

const RankedUnitsSchema = z.object({
  count: z.number(),
  total_usd: z.number(),
  avg_usd: z.number(),
  median_usd: z.number(),
  most: z.array(CostUnitSchema),
  least: z.array(CostUnitSchema),
});

const UnitCostsSchema = z.object({
  tickets: RankedUnitsSchema,
  reviews: z.object({
    per_pr: RankedUnitsSchema,
    by_line: z.array(
      z.object({
        blueprint: z.string(),
        runs: z.number(),
        total_usd: z.number(),
        avg_usd: z.number(),
      }),
    ),
    by_model: z.array(
      z.object({ model: z.string(), calls: z.number(), cost_usd: z.number() }),
    ),
  }),
  nodes: z.array(
    z.object({
      blueprint: z.string(),
      node_id: z.string(),
      visits: z.number(),
      total_usd: z.number(),
      per_visit_usd: z.number(),
      models: z.array(z.string()),
    }),
  ),
});

const LiveSchema = z.object({
  name: z.string(),
  phase: z.string(),
  started_at: z.string().nullable(),
  requests: z.record(z.string(), z.string()),
  usd_per_hour: z.number(),
  usd_so_far: z.number(),
  station_run_id: z.string().nullable(),
});

export const SpendWindowSchema = z.object({
  interval: z.object({ from: z.string(), to: z.string() }),
  llm: z.object({
    total_usd: z.number(),
    calls: z.number(),
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_read_tokens: z.number(),
    cache_write_tokens: z.number(),
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
    assumed_profile: z.record(z.string(), z.string()),
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
  // What a unit of work costs (#2116): per ticket, per PR review, per node visit.
  unit_costs: UnitCostsSchema,
});
