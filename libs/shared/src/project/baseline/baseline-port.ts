/**
 * One row in `pipeline.dark_factory_baseline`: a pre-feature counter snapshot
 * over a 30-day window per repo, used for the SC1/SC4/SC6 dark-factory deltas.
 */
export interface BaselineRow {
  repo: string;
  window_start: Date;
  window_end: Date;
  counters: Record<string, unknown>;
}

/** Pre-feature counters over a window, used by the dark-factory baseline. */
export interface TaskBaselineStats {
  /** Tasks in the window that produced a PR (`pr_url IS NOT NULL`). */
  issues_count: number;
  /** Median hours from create→update for the window, or null when no tasks. */
  median_ttm_hours: number | null;
}

/**
 * The dark-factory baseline surface. Absorbs the Floor-local baseline writer
 * and the tasks-table baseline read, so the snapshot job reaches both through
 * the Project facade instead of two bespoke repos.
 */
export interface BaselinePort {
  /** Append a baseline snapshot row to `pipeline.dark_factory_baseline`. */
  insert(row: BaselineRow): Promise<void>;
  /** Compute the pre-feature counters for a repo over a window from `pipeline.tasks`. */
  baselineStats(
    repo: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<TaskBaselineStats>;
}
