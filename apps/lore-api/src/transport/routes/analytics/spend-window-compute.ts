import type { Pool } from "pg";
import {
  DEFAULT_POD_PROFILE,
  podHourlyUsd,
  ratesFromEnv,
} from "../../../work/analytics/compute-cost.js";
import type { SpendWindow } from "./spend-window-db.js";

export interface SpendWindowDeps {
  env: NodeJS.ProcessEnv;
  now(): Date;
}

const POD_HOURS_SQL = `SELECT ar.blueprint_name AS blueprint,
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
      GROUP BY 1 ORDER BY 3 DESC`;

/** Estimated pod cost: hours already burned in the interval, priced at the assumed profile. */
export async function readComputeSpend(
  pool: Pool,
  win: SpendWindow,
  deps: SpendWindowDeps,
) {
  const rates = ratesFromEnv(deps.env);
  const podHourRows = pricedPodHours(
    await readPodHours(pool, win.fromTs, win.toTs),
    podHourlyUsd(DEFAULT_POD_PROFILE, rates),
  );
  const estTotalUsd = podHourRows.reduce((sum, r) => sum + r.est_usd, 0);

  return {
    rates: ratesSection(rates),
    assumed_profile: DEFAULT_POD_PROFILE,
    pod_hours: podHourRows,
    est_total_usd: Math.round(estTotalUsd * 100) / 100,
  };
}

/** Rows whose run overlaps the interval, clipped to it; only Agent-CR rows are pods. An open finished_at is capped at started_at+2h (the reaper's ceiling) — uncapped, 177 comment-triage pods once billed 8,606 pod-hours from unrecorded deaths. */
async function readPodHours(pool: Pool, fromTs: string, toTs: string) {
  const { rows } = await pool.query(POD_HOURS_SQL, [fromTs, toTs]);

  return rows as Array<{ blueprint: string; pods: number; hours: number }>;
}

function pricedPodHours(
  podHours: Awaited<ReturnType<typeof readPodHours>>,
  profileRate: number,
) {
  return podHours.map((row) => ({
    ...row,
    hours: Math.round(row.hours * 100) / 100,
    est_usd: Math.round(row.hours * profileRate * 100) / 100,
  }));
}

function ratesSection(rates: ReturnType<typeof ratesFromEnv>) {
  return {
    cpu_hour_usd: rates.cpuHourUsd,
    mem_gib_hour_usd: rates.memGibHourUsd,
  };
}
