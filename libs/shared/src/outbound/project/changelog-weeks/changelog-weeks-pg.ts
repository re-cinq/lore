import {
  CHANGELOG_WEEK_COLUMNS,
  CHANGELOG_WEEK_TABLE,
  type ChangelogWeek,
} from "../../../domain/models/changelog-week.js";
import { fromRow, selectList, type DbRow } from "../../../lib/row.js";
import type { PgPool } from "../../memory-store.js";
import type {
  ChangelogWeeksPort,
  ChangelogWeekWrite,
} from "./changelog-weeks-port.js";

/** Postgres-backed ChangelogWeeksPort over `lore.changelog_weeks`; week keys are zero-padded, so they sort as text. */
export class PgChangelogWeeks implements ChangelogWeeksPort {
  constructor(private readonly pool: PgPool) {}

  async upsert({ repo, weekKey, intro, changes }: ChangelogWeekWrite) {
    await this.pool.query(
      `INSERT INTO ${CHANGELOG_WEEK_TABLE} (repo, week_key, intro, changes)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (repo, week_key) DO UPDATE
         SET intro = EXCLUDED.intro, changes = EXCLUDED.changes, written_at = now()`,
      [repo, weekKey, intro, JSON.stringify(changes)],
    );
  }

  async writtenWeeks(repo: string, weekKeys: string[]): Promise<string[]> {
    const { rows } = await this.pool.query<{ week_key: string }>(
      `SELECT week_key FROM ${CHANGELOG_WEEK_TABLE}
        WHERE repo = $1 AND week_key = ANY($2::text[])`,
      [repo, weekKeys],
    );

    return rows.map((row) => row.week_key);
  }

  async page(
    repo: string,
    { before, limit }: { before?: string; limit: number },
  ): Promise<ChangelogWeek[]> {
    const { rows } = await this.pool.query<DbRow>(
      `SELECT ${selectList(CHANGELOG_WEEK_COLUMNS)} FROM ${CHANGELOG_WEEK_TABLE}
        WHERE repo = $1 AND ($2::text IS NULL OR week_key < $2)
        ORDER BY week_key DESC
        LIMIT $3`,
      [repo, before ?? null, limit],
    );

    return rows.map((row) =>
      fromRow<ChangelogWeek>(CHANGELOG_WEEK_COLUMNS, row),
    );
  }
}
