import { describe, it, expect } from "vitest";
import { formatSpecDriftReport } from "./format-drift-report.js";

describe("formatSpecDriftReport — pure markdown formatter, findings in / string out (spec-traceability-graph Phase 7 / T273)", () => {
  it("returns an empty string for no drift findings", () => {
    expect(formatSpecDriftReport([])).toBe("");
  });

  it("includes the spec path, statement text, and reason for a single drift finding", () => {
    const report = formatSpecDriftReport([
      {
        specPath: "specs/foo/spec.md",
        ordinal: 7,
        statementText: "The widget renders a click.",
        reason: "validating test failed: renders a click",
      },
    ]);

    expect(report).not.toBe("");
    expect(report).toContain("specs/foo/spec.md");
    expect(report).toContain("The widget renders a click.");
    expect(report).toContain("validating test failed: renders a click");
  });
});
