import { describe, it, expect } from "vitest";
import { assertReportIdentity, saveReportEvidence } from "./report-evidence.js";

const COMMIT = "a".repeat(40);

function envelopeCountingReads() {
  const reads = { tests: 0 };
  const tests = [
    {
      id: "widget-case",
      name: "renders widget",
      file: "src/widget.test.ts",
      startLine: 1,
      runnerId: "widget-case",
      execution: {
        status: "passed",
        location: { line: 1, column: 1 },
        expectedFailure: false,
        fileCaseCount: 1,
      },
    },
  ];
  const report = {
    commit: COMMIT,
    branch: "main",
    results: [{ id: "widget-case", passed: true }],
    get tests() {
      reads.tests += 1;

      return tests;
    },
  };

  return { reads, body: { kind: "test-report", commit: COMMIT, report } };
}

describe("report evidence", () => {
  it("reads the reported tests once for the identity check and the save", async () => {
    const { reads, body } = envelopeCountingReads();
    const pool = { query: async () => ({ rows: [] }) } as never;

    assertReportIdentity(body);
    await saveReportEvidence(pool, "org/repo", body);

    expect(reads.tests).toEqual(1);
  });
});
