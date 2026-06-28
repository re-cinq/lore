import { query, queryOne } from "../db.js";

/** Pre-feature counters over a window, used by the dark-factory baseline. */
export interface TaskBaselineStats {
  /** Tasks in the window that produced a PR (`pr_url IS NOT NULL`). */
  issues_count: number;
  /** Median hours from create→update for the window, or null when no tasks. */
  median_ttm_hours: number | null;
}

/** PR coordinates for one task, used by the auto-merge policy lookup. */
export interface TaskPrInfo {
  pr_number: number | null;
  target_repo: string | null;
  target_branch: string | null;
}

/** A task row the in-memory double computes its answers from. */
export interface TaskRecord {
  id?: string;
  target_repo: string | null;
  created_at: Date;
  updated_at: Date;
  pr_url?: string | null;
  pr_number?: number | null;
  target_branch?: string | null;
}

export interface TasksRepository {
  baselineStats(repo: string, windowStart: Date, windowEnd: Date): Promise<TaskBaselineStats>;
  distinctTargetRepos(): Promise<string[]>;
  prInfo(taskId: string): Promise<TaskPrInfo | null>;
}

interface BaselineStatsRow {
  issues_count: string | null;
  median_ttm: string | null;
}

export class PgTasksRepository implements TasksRepository {
  async baselineStats(
    repo: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<TaskBaselineStats> {
    const row = await queryOne<BaselineStatsRow>(
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
    return {
      issues_count: parseInt(row?.issues_count ?? "0", 10),
      median_ttm_hours: row?.median_ttm ? parseFloat(row.median_ttm) : null,
    };
  }

  async distinctTargetRepos(): Promise<string[]> {
    const rows = await query<{ target_repo: string }>(
      `SELECT DISTINCT target_repo
         FROM pipeline.tasks
        WHERE target_repo IS NOT NULL
        ORDER BY target_repo`,
    );
    return rows.map((r) => r.target_repo);
  }

  async prInfo(taskId: string): Promise<TaskPrInfo | null> {
    const rows = await query<TaskPrInfo>(
      `SELECT pr_number, target_repo, target_branch
         FROM pipeline.tasks WHERE id = $1`,
      [taskId],
    );
    return rows[0] ?? null;
  }
}

/** In-memory test double computing the same answers from seeded task rows. */
export class InMemoryTasksRepository implements TasksRepository {
  constructor(public tasks: TaskRecord[] = []) {}

  async baselineStats(
    repo: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<TaskBaselineStats> {
    const inWindow = this.tasks.filter(
      (t) =>
        t.target_repo === repo &&
        t.created_at.getTime() >= windowStart.getTime() &&
        t.created_at.getTime() < windowEnd.getTime(),
    );
    const issues_count = inWindow.filter((t) => t.pr_url != null).length;
    const ttms = inWindow
      .map((t) => (t.updated_at.getTime() - t.created_at.getTime()) / 3600_000)
      .sort((a, b) => a - b);
    return { issues_count, median_ttm_hours: median(ttms) };
  }

  async distinctTargetRepos(): Promise<string[]> {
    const repos = new Set<string>();
    for (const t of this.tasks) if (t.target_repo) repos.add(t.target_repo);
    return [...repos].sort();
  }

  async prInfo(taskId: string): Promise<TaskPrInfo | null> {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    return {
      pr_number: task.pr_number ?? null,
      target_repo: task.target_repo,
      target_branch: task.target_branch ?? null,
    };
  }
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
