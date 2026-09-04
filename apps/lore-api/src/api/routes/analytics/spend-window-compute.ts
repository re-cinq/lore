import type { Pool } from "pg";
import type { RunningPodInfo } from "@re-cinq/lore-shared";
import {
  DEFAULT_POD_PROFILE,
  podHourlyUsd,
  ratesFromEnv,
} from "../../../features/analytics/compute-cost.js";
import type { SpendWindow } from "./spend-window-db.js";

export interface SpendWindowDeps {
  /** The central cluster's running pods; [] when the agent is unreachable. */
  livePods(): Promise<RunningPodInfo[]>;
  env: NodeJS.ProcessEnv;
  now(): Date;
}

/** What the pods running right now are spending. A live-read failure yields an empty list — the metered numbers must render regardless of the cluster. */
async function readLivePods(
  deps: SpendWindowDeps,
  rates: ReturnType<typeof ratesFromEnv>,
) {
  const nowMs = deps.now().getTime();
  const livePods = await deps.livePods().catch(() => []);

  return livePods.map((pod) => {
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
}

/** Rows whose run overlaps the interval, clipped to it; only Agent-CR rows are pods. An open finished_at is capped at started_at+2h (the reaper's ceiling) — uncapped, 177 comment-triage pods once billed 8,606 pod-hours from unrecorded deaths. */
async function readPodHours(pool: Pool, fromTs: string, toTs: string) {
  const { rows } = await pool.query(
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

  return rows as Array<{ blueprint: string; pods: number; hours: number }>;
}

/** Estimated pod cost: hours already burned in the interval, priced at the assumed profile, plus what the live pods are spending right now. */
export async function readComputeSpend(
  pool: Pool,
  win: SpendWindow,
  deps: SpendWindowDeps,
) {
  const podHours = await readPodHours(pool, win.fromTs, win.toTs);
  const rates = ratesFromEnv(deps.env);
  const profileRate = podHourlyUsd(DEFAULT_POD_PROFILE, rates);
  const podHourRows = podHours.map((row) => ({
    ...row,
    hours: Math.round(row.hours * 100) / 100,
    est_usd: Math.round(row.hours * profileRate * 100) / 100,
  }));

  const live = await readLivePods(deps, rates);

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
