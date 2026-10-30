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
  /** The commit's report completed with the files it did not run, taken from the newest earlier reports of its branch (a push runs only the files it affects); null when CI never reported the commit itself. */
  forCommitWithHistory(
    repo: string,
    commit: string,
  ): Promise<TestReportRow | null>;
}

/** How many earlier reports of a branch complete a commit's: a week of pushes holds a full run, and each row can be megabytes. */
export const REPORT_HISTORY_DEPTH = 50;
