import type { PgPool } from "../../memory-store.js";
import { firstOf, fromRow, selectList } from "../../../lib/row.js";
import {
  TEST_REPORT_COLUMNS,
  TEST_REPORT_TABLE,
  type TestReport,
} from "../../../domain/models/test-report.js";
import type {
  NewTestReport,
  TestReportRow,
  TestReportsRepository,
} from "./test-reports-port.js";

const SELECT_COLUMNS = selectList(TEST_REPORT_COLUMNS);

/** The driver hands `id` back as a bigint string already; jsonb columns arrive parsed. */
function toRow(row: Record<string, unknown>): TestReportRow {
  const report = fromRow<TestReport>(TEST_REPORT_COLUMNS, row);

  return { ...report, id: String(report.id) };
}

/** Postgres-backed {@link TestReportsRepository}; the upsert keys on the UNIQUE (repo, commit) from migration 0069. */
export class PgTestReports implements TestReportsRepository {
  constructor(private readonly pool: PgPool) {}

  async upsertLatest(report: NewTestReport): Promise<TestReportRow> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO ${TEST_REPORT_TABLE} (repo, commit, branch, tests, outcomes)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (repo, commit) DO UPDATE
         SET branch = EXCLUDED.branch,
             tests = EXCLUDED.tests,
             outcomes = EXCLUDED.outcomes,
             received_at = now()
       RETURNING ${SELECT_COLUMNS}`,
      [
        report.repo,
        report.commit,
        report.branch,
        JSON.stringify(report.tests),
        JSON.stringify(report.outcomes),
      ],
    );

    return toRow(rows[0]);
  }

  async latestForBranch(
    repo: string,
    branch: string,
  ): Promise<TestReportRow | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT ${SELECT_COLUMNS} FROM ${TEST_REPORT_TABLE}
        WHERE repo = $1 AND branch = $2
        ORDER BY received_at DESC, id DESC
        LIMIT 1`,
      [repo, branch],
    );
    const row = firstOf(rows);

    return row ? toRow(row) : null;
  }

  async forCommit(repo: string, commit: string): Promise<TestReportRow | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT ${SELECT_COLUMNS} FROM ${TEST_REPORT_TABLE}
        WHERE repo = $1 AND commit = $2`,
      [repo, commit],
    );
    const row = firstOf(rows);

    return row ? toRow(row) : null;
  }
}
