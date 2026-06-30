import type { PgPool } from "../../memory-store.js";
import type { BaselinePort, BaselineRow, TaskBaselineStats } from "./baseline-port.js";

interface BaselineStatsRow {
  issues_count: string | null;
  median_ttm: string | null;
}

/**
 * Postgres-backed {@link BaselinePort}: one INSERT into
 * `pipeline.dark_factory_baseline` plus the windowed SELECT over
 * `pipeline.tasks`. Relocated from the Floor's `repositories/baseline` and
 * `repositories/tasks` so the snapshot job reaches both through the facade.
 */
export class PgBaseline implements BaselinePort {
  constructor(private readonly pool: PgPool) {}

  async insert(row: BaselineRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.dark_factory_baseline
         (repo, window_start, window_end, counters)
       VALUES ($1, $2, $3, $4)`,
      [row.repo, row.window_start, row.window_end, JSON.stringify(row.counters)],
    );
  }

  async baselineStats(
    repo: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<TaskBaselineStats> {
    const { rows } = await this.pool.query(
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
    const row = rows[0] as BaselineStatsRow | undefined;
    return {
      issues_count: parseInt(row?.issues_count ?? "0", 10),
      median_ttm_hours: row?.median_ttm ? parseFloat(row.median_ttm) : null,
    };
  }
}
