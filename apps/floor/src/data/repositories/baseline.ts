import { query } from "../db.js";

export interface BaselineRow {
  repo: string;
  window_start: Date;
  window_end: Date;
  counters: Record<string, unknown>;
}

export interface BaselineRepository {
  insert(row: BaselineRow): Promise<void>;
}

export class PgBaselineRepository implements BaselineRepository {
  async insert(row: BaselineRow): Promise<void> {
    await query(
      `INSERT INTO pipeline.dark_factory_baseline
         (repo, window_start, window_end, counters)
       VALUES ($1, $2, $3, $4)`,
      [row.repo, row.window_start, row.window_end, JSON.stringify(row.counters)],
    );
  }
}

/** In-memory test double: keeps every inserted baseline row. */
export class InMemoryBaselineRepository implements BaselineRepository {
  readonly rows: BaselineRow[] = [];

  async insert(row: BaselineRow): Promise<void> {
    this.rows.push(row);
  }
}
