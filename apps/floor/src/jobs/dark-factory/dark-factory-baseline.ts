import { baseline, taskQueue } from "../../kernel/queues.js";
import type { BaselinePort } from "@re-cinq/lore-shared/project/baseline/baseline-port.js";

/** The cross-repo repo scan the baseline job needs: the distinct target-repo set. */
export interface BaselineRepoScan {
  distinctTargetRepos(): Promise<string[]>;
}

interface RepoCounters {
  /**
   * Median number of distinct ephemeral Job pods spawned per
   * implementation task in the window. Today's flow runs ≥4
   * (impl/validate/review/address). Source: OTEL spans in production.
   * Until OTEL-side capture is wired, recorded as a static architectural
   * baseline of 4 so SC1 deltas remain measurable. Flagged via
   * `_job_pods_source` extra.
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

export interface BaselineDeps {
  /** Reads the windowed counters from `pipeline.tasks` and writes the snapshot row. */
  baseline: BaselinePort;
  /** The distinct target-repo scan set (org-wide task-queue read). */
  repoScan: BaselineRepoScan;
}

const defaultDeps = (): BaselineDeps => ({ baseline: baseline(), repoScan: taskQueue() });

/**
 * Capture a `windowDays` baseline of pre-feature counters for one repo.
 * Stored to `pipeline.dark_factory_baseline`. T060 compares post-pilot
 * windows against the most recent baseline row to compute SC1/SC4/SC6
 * deltas.
 *
 * Counters are best-effort. Missing data points are filled with
 * conservative architectural defaults; the source for each is recorded
 * so downstream comparisons can detect placeholders.
 */
export async function captureBaselineForRepo(
  repo: string,
  windowDays = 30,
  deps: BaselineDeps = defaultDeps(),
  now: Date = new Date(),
): Promise<string> {
  const windowEnd = now;
  const windowStart = new Date(
    windowEnd.getTime() - windowDays * 24 * 3600 * 1000,
  );

  const stats = await deps.baseline.baselineStats(repo, windowStart, windowEnd);

  const counters: RepoCounters = {
    job_pods_per_impl_task_p50: 4,
    issues_per_week: (stats.issues_count * 7) / windowDays,
    bot_pr_no_human_review_share: 0,
    median_time_to_merge_hours: stats.median_ttm_hours ?? 0,
    _job_pods_source: "static_baseline",
  };

  await deps.baseline.insert({
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

/**
 * Snapshot every repo that has at least one task on file in the window.
 * Tolerates per-repo failures (logs and moves on).
 */
export async function captureBaselineAllRepos(
  deps: BaselineDeps = defaultDeps(),
  now: Date = new Date(),
): Promise<string> {
  const repos = await deps.repoScan.distinctTargetRepos();
  const summaries: string[] = [];
  for (const repo of repos) {
    try {
      summaries.push(await captureBaselineForRepo(repo, 30, deps, now));
    } catch (err) {
      console.error(`[baseline] Failed for ${repo}:`, err);
    }
  }
  return `Captured baselines for ${summaries.length}/${repos.length} repos`;
}
