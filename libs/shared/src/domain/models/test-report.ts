import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `pipeline.test_reports` (migration `0069`) — the latest lore-code-trace report per (repo, commit), what the Definition-of-Done read matches acceptance tests against; `id` is a string-encoded bigint like agent-run-event; no FKs (a report may arrive for a branch no run owns). */

/** One test as the report describes it: the descriptor trimmed to what a match needs. */
export const ReportedTestSchema = z.object({
  id: z.string(),
  name: z.string(),
  file: z.string(),
  suite: z.array(z.string()).optional(),
  startLine: z.number().optional(),
});

export type ReportedTest = z.infer<typeof ReportedTestSchema>;

export const TestReportSchema = z.object({
  id: z.string(),
  repo: z.string(),
  commit: z.string(),
  branch: z.string(),
  tests: z.array(ReportedTestSchema),
  /** Test id → passed. */
  outcomes: z.record(z.string(), z.boolean()),
  receivedAt: z.date(),
});

export type TestReport = z.infer<typeof TestReportSchema>;

export const TEST_REPORT_COLUMNS = {
  id: "id",
  repo: "repo",
  commit: "commit",
  branch: "branch",
  tests: "tests",
  outcomes: "outcomes",
  receivedAt: "received_at",
} as const satisfies ColumnMap<TestReport>;

export const TEST_REPORT_TABLE = "pipeline.test_reports";
