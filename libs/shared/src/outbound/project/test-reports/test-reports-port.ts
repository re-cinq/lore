import type {
  ReportedTest,
  TestReport,
} from "../../../domain/models/test-report.js";

export type { ReportedTest };

/** One pipeline.test_reports row (see models/test-report.ts). */
export type TestReportRow = TestReport;

/** What the CI ingest supplies; id/receivedAt are minted by the store. */
export type NewTestReport = Omit<TestReportRow, "id" | "receivedAt">;

/** The latest lore-code-trace report per (repo, commit): CI writes via upsertLatest, the Definition-of-Done read asks per branch or per commit. */
export interface TestReportsRepository {
  /** Replaces the row for (repo, commit) — re-posting a commit is the newer truth, not a second row. */
  upsertLatest(report: NewTestReport): Promise<TestReportRow>;
  /** The most recently received report on a branch, or null when CI has posted none. */
  latestForBranch(repo: string, branch: string): Promise<TestReportRow | null>;
  /** The report for one commit, or null. */
  forCommit(repo: string, commit: string): Promise<TestReportRow | null>;
}
