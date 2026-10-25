import type { Pool } from "pg";

const UPSERT_TEST_REPORT_SQL = `INSERT INTO pipeline.test_reports (repo, commit, branch, tests, outcomes)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     ON CONFLICT (repo, commit) DO UPDATE
       SET branch = EXCLUDED.branch,
           tests = EXCLUDED.tests,
           outcomes = EXCLUDED.outcomes,
           received_at = now()`;

export type TestReportInput = {
  repo: string;
  commit: string;
  branch: string;
  tests: unknown;
  outcomes: unknown;
};

/** Upserts one lore-code-trace test report into pipeline.test_reports. Re-posting a commit replaces its row. */
export async function saveTestReportRow(
  pool: Pool,
  row: TestReportInput,
): Promise<void> {
  await pool.query(UPSERT_TEST_REPORT_SQL, [
    row.repo,
    row.commit,
    row.branch,
    JSON.stringify(row.tests),
    JSON.stringify(row.outcomes),
  ]);
}
