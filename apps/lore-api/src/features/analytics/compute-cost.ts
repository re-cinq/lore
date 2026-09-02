// The pure half of the spend page's Kubernetes cost ESTIMATE.
//
// Google's billing export lags a day or more, so a realtime number can only be
// an estimate — and the honest estimator is resource REQUESTS × on-demand
// rates, because requests are what size the nodes the autoscaler bills for.
// The rates are env-overridable and default to an e2 on-demand ballpark; the
// response always echoes the rates and profile used, so the UI can label the
// number as the estimate it is instead of dressing it up as an invoice.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

export interface ComputeRates {
  cpuHourUsd: number;
  memGibHourUsd: number;
}

/** e2 on-demand ballpark (per vCPU-hour / per GiB-hour). Overridable so a
 *  different machine family or a committed-use discount can be reflected
 *  without a release. */
const DEFAULT_RATES: ComputeRates = { cpuHourUsd: 0.022, memGibHourUsd: 0.003 };

/** What a historical pod is ASSUMED to have requested when its actual requests
 *  are gone with it — station_runs records when a pod ran, not how big it was.
 *  Deliberately modest; the live view uses each pod's real requests. */
export const DEFAULT_POD_PROFILE: Record<string, string> = {
  cpu: "1",
  memory: "4Gi",
};

export function ratesFromEnv(env: NodeJS.ProcessEnv): ComputeRates {
  const num = (raw: string | undefined, fallback: number): number => {
    const parsed = Number(raw);

    return raw !== undefined && Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : fallback;
  };

  return {
    cpuHourUsd: num(env.LORE_GKE_CPU_HOUR_USD, DEFAULT_RATES.cpuHourUsd),
    memGibHourUsd: num(
      env.LORE_GKE_MEM_GIB_HOUR_USD,
      DEFAULT_RATES.memGibHourUsd,
    ),
  };
}

/** Kubernetes cpu quantity → cores. Absent or malformed reads as zero: a
 *  missing request must cost the estimate nothing rather than poison it. */
export function parseCpuCores(quantity: string | undefined): number {
  if (!quantity) {
    return 0;
  }
  const milli = /^(\d+(?:\.\d+)?)m$/.exec(quantity);

  if (milli) {
    return Number(milli[1]) / 1000;
  }
  const cores = Number(quantity);

  return Number.isFinite(cores) ? cores : 0;
}

const MEM_UNITS: Record<string, number> = {
  Gi: 1,
  Mi: 1 / 1024,
  Ki: 1 / (1024 * 1024),
  G: 1e9 / 2 ** 30,
  M: 1e6 / 2 ** 30,
  K: 1e3 / 2 ** 30,
};

/** Kubernetes memory quantity → GiB, same zero-on-malformed rule as cpu. */
export function parseMemGib(quantity: string | undefined): number {
  if (!quantity) {
    return 0;
  }
  const m = /^(\d+(?:\.\d+)?)(Gi|Mi|Ki|G|M|K)?$/.exec(quantity);

  if (!m) {
    return 0;
  }
  const unit = m[2] ? MEM_UNITS[m[2]] : 1 / 2 ** 30;

  return Number(m[1]) * unit;
}

/** A pod's estimated $/hour from its requests. */
export function podHourlyUsd(
  requests: Record<string, string>,
  rates: ComputeRates,
): number {
  return (
    parseCpuCores(requests.cpu) * rates.cpuHourUsd +
    parseMemGib(requests.memory) * rates.memGibHourUsd
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The spend page's date interval, validated: inclusive YYYY-MM-DD bounds,
 * defaulting to the last 7 days ending today, capped at 92 days so one query
 * cannot aggregate a year of llm_calls rows.
 */
export function spendInterval(
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = now.toISOString().slice(0, 10);
  const resolvedTo = to ?? today;
  const resolvedFrom =
    from ?? new Date(now.getTime() - 7 * DAY_MS).toISOString().slice(0, 10);

  for (const value of [resolvedFrom, resolvedTo]) {
    enforceTrue(
      ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)),
      Error,
      "dates must be YYYY-MM-DD",
    );
  }

  enforceTrue(resolvedFrom <= resolvedTo, Error, "from must not be after to");

  const span = (Date.parse(resolvedTo) - Date.parse(resolvedFrom)) / DAY_MS + 1;

  enforceTrue(
    span <= MAX_SPAN_DAYS,
    Error,
    `interval must span at most ${MAX_SPAN_DAYS} days`,
  );

  return { from: resolvedFrom, to: resolvedTo };
}
