import type {
  BaselinePort,
  BaselineRow,
  TaskBaselineStats,
} from "./baseline-port.js";

/** A task row the in-memory double computes its baseline answers from. */
export interface TaskRecord {
  target_repo: string | null;
  created_at: Date;
  updated_at: Date;
  pr_url?: string | null;
}

/** In-memory {@link BaselinePort}: keeps every inserted snapshot row and computes windowed counters from seeded task rows. */
export class InMemoryBaseline implements BaselinePort {
  readonly rows: BaselineRow[] = [];

  constructor(public tasks: TaskRecord[] = []) {}

  async insert(row: BaselineRow): Promise<void> {
    this.rows.push(row);
  }

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
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
