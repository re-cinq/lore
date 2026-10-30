import type { Pool } from "pg";

const UPSERT_TEST_REPORT_SQL = `INSERT INTO pipeline.test_reports (repo, commit, branch, tests, outcomes)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     ON CONFLICT (repo, commit) DO UPDATE
       SET branch = EXCLUDED.branch,
           tests = COALESCE((
             SELECT jsonb_agg(old_test)
               FROM jsonb_array_elements(test_reports.tests) old_test
              WHERE NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(EXCLUDED.tests) incoming
                 WHERE incoming->>'file' = old_test->>'file'
              )
           ), '[]'::jsonb) || EXCLUDED.tests,
           outcomes = (test_reports.outcomes - ARRAY(
             SELECT old_test->>'id'
               FROM jsonb_array_elements(test_reports.tests) old_test
              WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements(EXCLUDED.tests) incoming
                 WHERE incoming->>'file' = old_test->>'file'
              )
           )) || EXCLUDED.outcomes,
           received_at = now()`;

export type TestReportInput = {
  repo: string;
  commit: string;
  branch: string;
  tests: unknown;
  outcomes: unknown;
};

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
