import type { Pool } from "pg";

const UPSERT_TEST_REPORT_SQL = `INSERT INTO pipeline.test_reports (repo, commit, branch, tests, outcomes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (repo, commit) DO UPDATE
       SET branch = EXCLUDED.branch,
           tests = EXCLUDED.tests,
           outcomes = EXCLUDED.outcomes,
           received_at = now()`;

/** Upserts one lore-code-trace test report into pipeline.test_reports. Re-posting a commit replaces its row. */
export async function saveTestReportRow(
  pool: Pool,
  repo: string,
  commit: string,
  branch: string,
  tests: unknown,
  outcomes: unknown,
): Promise<void> {
  await pool.query(UPSERT_TEST_REPORT_SQL, [
    repo,
    commit,
    branch,
    tests,
    outcomes,
  ]);
}
