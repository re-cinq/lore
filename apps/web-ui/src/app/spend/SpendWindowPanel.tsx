"use client";

// The spend page's interval view — the Panel suffix is the sanctioned place
// for this IO (lore/no-io-in-view): it owns the selected interval, fetches
// /api/spend-window for it, and renders the two halves the route serves — the
// metered LLM spend (realtime: cost rows land within seconds of each model
// call) and the Kubernetes compute ESTIMATE, labeled with the rates and
// assumptions it was computed from. Pure date arithmetic lives in
// spend-window-presets.ts.

import { useEffect, useState } from "react";
import {
  presetInterval,
  spendWindowQuery,
  type SpendPreset,
} from "./spend-window-presets";
import styles from "./SpendView.module.css";

interface SpendWindow {
  interval: { from: string; to: string };
  llm: {
    total_usd: number;
    calls: number;
    by_blueprint: Array<{ blueprint: string; runs: number; usd: number }>;
    by_repo: Array<{ repo: string; usd: number }>;
  };
  compute: {
    rates: { cpu_hour_usd: number; mem_gib_hour_usd: number };
    assumed_profile: Record<string, string>;
    pod_hours: Array<{
      blueprint: string;
      pods: number;
      hours: number;
      est_usd: number;
    }>;
    est_total_usd: number;
    live_pods: Array<{
      name: string;
      phase: string;
      started_at: string | null;
      requests: Record<string, string>;
      usd_per_hour: number;
      usd_so_far: number;
      station_run_id: string | null;
    }>;
    live_usd_per_hour: number;
  };
}

const usd = (value: number): string => `$${value.toFixed(2)}`;

const PRESETS: Array<{ key: SpendPreset; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "Month to date" },
];

export default function SpendWindowPanel() {
  const [interval, setInterval] = useState(() => presetInterval("7d"));
  const [data, setData] = useState<SpendWindow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The one fetch this component owns, re-run per selected interval. Every
  // setState sits past an await and behind the cancelled guard, so an interval
  // change mid-flight cannot land a stale window over a fresh one.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/spend-window?${spendWindowQuery(interval)}`,
          { signal: AbortSignal.timeout(30_000) },
        );
        const body = (await res.json()) as SpendWindow & { error?: string };

        if (cancelled) {
          return;
        }

        if (!res.ok) {
          setError(body.error ?? `spend-window returned ${res.status}`);

          return;
        }
        setData(body);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [interval]);

  return (
    <section aria-label="Spend for the selected interval">
      <h2>Interval</h2>
      <div className={styles.presetRow}>
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className="btn-secondary"
            onClick={() => setInterval(presetInterval(preset.key))}
          >
            {preset.label}
          </button>
        ))}
        <label className="meta">
          from{" "}
          <input
            type="date"
            value={interval.from}
            onChange={(e) =>
              setInterval((current) => ({ ...current, from: e.target.value }))
            }
          />
        </label>
        <label className="meta">
          to{" "}
          <input
            type="date"
            value={interval.to}
            onChange={(e) =>
              setInterval((current) => ({ ...current, to: e.target.value }))
            }
          />
        </label>
      </div>

      {error !== null && <p className="meta">{error}</p>}

      {data !== null && (
        <>
          <div className={styles.cards}>
            <div className={`spec-card ${styles.card}`}>
              <div className="meta">
                LLM spend {data.interval.from} → {data.interval.to}
              </div>
              <div className={styles.figure}>{usd(data.llm.total_usd)}</div>
              <div className={`meta ${styles.subnote}`}>
                {data.llm.calls} calls
              </div>
            </div>
            <div className={`spec-card ${styles.card}`}>
              <div className="meta">Kubernetes (estimated)</div>
              <div className={styles.figureInfo}>
                {usd(data.compute.est_total_usd)}
              </div>
              <div className={`meta ${styles.subnote}`}>
                + {usd(data.compute.live_usd_per_hour)}/h burning now
              </div>
            </div>
          </div>

          <h3>LLM by assembly line</h3>
          <table>
            <thead>
              <tr>
                <th>Assembly line</th>
                <th>Runs</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.llm.by_blueprint.map((row) => (
                <tr key={row.blueprint}>
                  <td>{row.blueprint}</td>
                  <td>{row.runs}</td>
                  <td>{usd(row.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Pods running now</h3>
          {data.compute.live_pods.length === 0 ? (
            <p className="meta">No run pods are live right now.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Pod</th>
                  <th>Requests</th>
                  <th>$/hour</th>
                  <th>So far</th>
                </tr>
              </thead>
              <tbody>
                {data.compute.live_pods.map((pod) => (
                  <tr key={pod.name}>
                    <td>{pod.name}</td>
                    <td>
                      {pod.requests.cpu ?? "—"} cpu ·{" "}
                      {pod.requests.memory ?? "—"}
                    </td>
                    <td>{usd(pod.usd_per_hour)}</td>
                    <td>{usd(pod.usd_so_far)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>Pod-hours in interval</h3>
          <table>
            <thead>
              <tr>
                <th>Assembly line</th>
                <th>Pods</th>
                <th>Hours</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {data.compute.pod_hours.map((row) => (
                <tr key={row.blueprint}>
                  <td>{row.blueprint}</td>
                  <td>{row.pods}</td>
                  <td>{row.hours}</td>
                  <td>{usd(row.est_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`meta ${styles.subnote}`}>
            Compute is an estimate from resource requests × on-demand rates ($
            {data.compute.rates.cpu_hour_usd}/cpu-h, $
            {data.compute.rates.mem_gib_hour_usd}/GiB-h); interval pod-hours
            assume a {data.compute.assumed_profile.cpu} cpu /{" "}
            {data.compute.assumed_profile.memory} pod. Google&apos;s invoice
            lags a day and is the truth.
          </p>
        </>
      )}
    </section>
  );
}
