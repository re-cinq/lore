import type { Pool } from "pg";
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
 * GET /api/analytics/spend-window?from&to — the spend page's interval view:
 * metered LLM spend from `pipeline.llm_calls` (realtime — the agent-events
 * sink writes cost rows within seconds of each model call) plus the
 * Kubernetes compute ESTIMATE, both halves of it:
 *
 * - historical: station-run pod-hours in the interval × an assumed pod
 *   profile — `station_runs` records when each pod ran, not how big it was,
 *   so the response names the profile and rates it assumed;
 * - live: the running pods right now, each priced from its ACTUAL resource
 *   requests (requests are what size the nodes the autoscaler bills for),
 *   read through the central cluster-agent. A satellite's pods are not in
 *   this view, and an unreachable cluster-agent degrades to an empty live
 *   list rather than failing the page.
 *
 * The interval bounds the METERED reads; the live list is by nature "now".
 */

const LiveSchema = z.object({
  name: z.string(),
  phase: z.string(),
  started_at: z.string().nullable(),
  requests: z.record(z.string()),
  usd_per_hour: z.number(),
  usd_so_far: z.number(),
  station_run_id: z.string().nullable(),
});

const SpendWindowSchema = z.object({
  interval: z.object({ from: z.string(), to: z.string() }),
  llm: z.object({
    total_usd: z.number(),
    calls: z.number(),
    by_blueprint: z.array(
      z.object({
        blueprint: z.string(),
        runs: z.number(),
        usd: z.number(),
      }),
    ),
    by_repo: z.array(z.object({ repo: z.string(), usd: z.number() })),
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
        "Interval-scoped LLM spend plus the estimated Kubernetes compute cost",
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
        `SELECT count(*)::int AS calls, coalesce(sum(cost_usd), 0)::float AS usd
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
      // Pod-hours: rows whose run overlaps the interval, clipped to it. Only
      // rows that named an Agent CR were pods; service-node rows cost nothing.
      const { rows: podHours } = await pool.query(
        `SELECT ar.blueprint_name AS blueprint,
                count(*)::int AS pods,
                coalesce(sum(
                  extract(epoch FROM
                    least(coalesce(sr.finished_at, now()), $2::timestamptz)
                    - greatest(sr.started_at, $1::timestamptz)
                  )
                ) / 3600.0, 0)::float AS hours
           FROM pipeline.station_runs sr
           JOIN pipeline.assembly_runs ar ON ar.id = sr.assembly_run_id
          WHERE sr.agent_cr_name IS NOT NULL
            AND sr.started_at < $2
            AND coalesce(sr.finished_at, now()) > $1
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

      return h
        .response({
          interval,
          llm: {
            total_usd: (totals[0] as { usd: number }).usd,
            calls: (totals[0] as { calls: number }).calls,
            by_blueprint: byBlueprint,
            by_repo: byRepo,
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
