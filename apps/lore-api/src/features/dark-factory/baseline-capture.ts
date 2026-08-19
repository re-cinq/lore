import type { BaselinePort } from "@re-cinq/lore-shared/project/baseline/baseline-port.js";

/**
 * The pre-enablement counter snapshot the Dark Factory pilot measures against
 * (SC1/SC4/SC6 in specs/6-dark-factory).
 *
 * Built in #307 and never wired to a caller: nothing wrote
 * `pipeline.dark_factory_baseline`, so the three success criteria that compare a
 * post-enable window against it were unmeasurable, while their tests passed
 * against the capture function directly (#1353).
 *
 * It lives in lore-api rather than the Floor because it is a read of
 * `pipeline.tasks` and one insert — no cluster authority, no drain loop
 * (ADR-024). And it lives next to the settings write because that write is the
 * trigger: a baseline is only meaningful if it is taken BEFORE the repo goes
 * dark, which a schedule cannot guarantee.
 */

export interface DarkFactoryState {
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * Capture only on the off→on transition.
 *
 * Re-capturing while already enabled would snapshot a window that is itself
 * post-enablement and overwrite the real pre-enable baseline — destroying the
 * comparison the snapshot exists for. Turning dark mode off captures nothing:
 * the next enablement takes its own.
 */
export function shouldCaptureBaseline(
  prev: DarkFactoryState,
  next: DarkFactoryState,
): boolean {
  return next.enabled === true && prev.enabled !== true;
}

interface RepoCounters {
  /**
   * Median distinct ephemeral Job pods per implementation task in the window.
   * Today's flow runs ≥4 (impl/validate/review/address). Until OTEL-side
   * capture is wired this is a static architectural baseline, flagged by
   * `_job_pods_source` so a downstream comparison can tell it from a measurement.
   */
  job_pods_per_impl_task_p50: number;
  /** GitHub Issues created by Lore per week in the window. */
  issues_per_week: number;
  /** Fraction of bot-authored merged PRs with no human review comment. */
  bot_pr_no_human_review_share: number;
  /** Median hours from PR open to merge for bot PRs in the window. */
  median_time_to_merge_hours: number;
  _job_pods_source: "static_baseline" | "otel";
  [key: string]: unknown;
}

const DAY_MS = 24 * 3600 * 1000;

/** Snapshot `windowDays` of pre-enablement counters for one repo. */
export async function captureBaselineForRepo(
  repo: string,
  baseline: BaselinePort,
  windowDays = 30,
  now: Date = new Date(),
): Promise<string> {
  const windowEnd = now;
  const windowStart = new Date(windowEnd.getTime() - windowDays * DAY_MS);
  const stats = await baseline.baselineStats(repo, windowStart, windowEnd);
  const counters: RepoCounters = {
    job_pods_per_impl_task_p50: 4,
    issues_per_week: (stats.issues_count * 7) / windowDays,
    bot_pr_no_human_review_share: 0,
    median_time_to_merge_hours: stats.median_ttm_hours ?? 0,
    _job_pods_source: "static_baseline",
  };

  await baseline.insert({
    repo,
    window_start: windowStart,
    window_end: windowEnd,
    counters,
  });

  return (
    `Captured baseline for ${repo} ` +
    `(window ${windowStart.toISOString().slice(0, 10)} → ` +
    `${windowEnd.toISOString().slice(0, 10)}): ` +
    JSON.stringify(counters)
  );
}
