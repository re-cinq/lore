import { describe, it, expect } from "vitest";
import { saveTestReportRow } from "./test-report-row.js";

describe("saveTestReportRow", () => {
  it("issues an upsert to pipeline.test_reports with branch in params", async () => {
    const issued: { sql: string; params: unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        issued.push({ sql, params });

        return { rows: [] };
      },
    } as never;

    await saveTestReportRow(pool, {
      repo: "org/repo",
      commit: "abc123",
      branch: "feature/foo",
      tests: [],
      outcomes: {},
    });

    const upsert = issued.find((q) => q.sql.includes("pipeline.test_reports"));

    expect(upsert).toBeDefined();
    expect(upsert?.params).toContain("feature/foo");
  });
});
