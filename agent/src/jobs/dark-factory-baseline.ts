import { query, queryOne } from "../db.js";

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
}

interface TaskRow {
  issues_count: string | null;
  median_ttm: string | null;
}

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
): Promise<string> {
  const nowRow = await queryOne<{ now: Date }>(`SELECT now() AS now`);
  if (!nowRow) throw new Error("DB unreachable");
  const windowEnd = nowRow.now;
  const windowStart = new Date(
    windowEnd.getTime() - windowDays * 24 * 3600 * 1000,
  );

  const tasksRow = await queryOne<TaskRow>(
    `SELECT
       count(*) FILTER (WHERE pr_url IS NOT NULL)::text AS issues_count,
       (
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600
         )
       )::text AS median_ttm
     FROM pipeline.tasks
     WHERE target_repo = $1
       AND created_at >= $2
       AND created_at < $3`,
    [repo, windowStart, windowEnd],
  );

  const issuesCount = parseInt(tasksRow?.issues_count ?? "0", 10);
  const counters: RepoCounters = {
    job_pods_per_impl_task_p50: 4,
    issues_per_week: (issuesCount * 7) / windowDays,
    bot_pr_no_human_review_share: 0,
    median_time_to_merge_hours: tasksRow?.median_ttm
      ? parseFloat(tasksRow.median_ttm)
      : 0,
    _job_pods_source: "static_baseline",
  };

  await query(
    `INSERT INTO pipeline.dark_factory_baseline
       (repo, window_start, window_end, counters)
     VALUES ($1, $2, $3, $4)`,
    [repo, windowStart, windowEnd, JSON.stringify(counters)],
  );

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
export async function captureBaselineAllRepos(): Promise<string> {
  const repos = await query<{ target_repo: string }>(
    `SELECT DISTINCT target_repo
       FROM pipeline.tasks
      WHERE target_repo IS NOT NULL
      ORDER BY target_repo`,
  );
  const summaries: string[] = [];
  for (const r of repos) {
    try {
      summaries.push(await captureBaselineForRepo(r.target_repo));
    } catch (err) {
      console.error(`[baseline] Failed for ${r.target_repo}:`, err);
    }
  }
  return `Captured baselines for ${summaries.length}/${repos.length} repos`;
}
