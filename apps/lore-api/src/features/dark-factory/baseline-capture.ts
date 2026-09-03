import type { BaselinePort } from "@re-cinq/lore-shared/project/baseline/baseline-port.js";

// Pre-enablement snapshot for Dark Factory pilot (SC1/SC4/SC6); captured before dark-mode enablement.
export interface DarkFactoryState {
  enabled?: boolean;
  [key: string]: unknown;
}

// Capture only on off→on transition; re-capturing would overwrite pre-enable baseline.
export function shouldCaptureBaseline(
  prev: DarkFactoryState,
  next: DarkFactoryState,
): boolean {
  return next.enabled === true && prev.enabled !== true;
}

interface RepoCounters {
  // Median Job pods per impl task; static baseline until OTEL-side capture (flagged by _job_pods_source).
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
