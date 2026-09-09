import { describe, it, expect } from "vitest";
import { dodSummary, statusGlyph, type DodProgress } from "./dod-progress-view";

const acceptanceTest = (
  status: "pass" | "fail" | "unknown",
): NonNullable<DodProgress["acceptanceTests"]>[number] => ({
  path: "src/a.test.ts",
  name: "does the thing",
  behaviour: "the thing happens",
  status,
  matchedId: status === "unknown" ? null : "src/a.test.ts::does the thing",
});

describe("dodSummary", () => {
  it("counts passes against the total and names the CI commit the count came from", () => {
    expect(
      dodSummary({
        present: true,
        acceptanceTests: [
          acceptanceTest("pass"),
          acceptanceTest("pass"),
          acceptanceTest("unknown"),
        ],
        passed: 2,
        total: 3,
        report: {
          commit: "abcdef0123456789",
          branch: "feat/x",
          receivedAt: "2026-09-09T10:00:00.000Z",
        },
      }),
    ).toEqual({
      label: "2 of 3 acceptance tests pass",
      tone: "running",
      hint: "as reported by CI @ abcdef0",
    });
  });

  it("reads red once any test fails, green once every test passes, and says when no report has arrived", () => {
    const failing = dodSummary({
      present: true,
      acceptanceTests: [acceptanceTest("pass"), acceptanceTest("fail")],
      passed: 1,
      total: 2,
      report: null,
    });
    const done = dodSummary({
      present: true,
      acceptanceTests: [acceptanceTest("pass")],
      passed: 1,
      total: 1,
      report: null,
    });

    expect(failing).toMatchObject({
      tone: "err",
      hint: "no CI report for this branch yet",
    });
    expect(done.tone).toBe("ok");
  });
});

describe("statusGlyph", () => {
  it("marks a pass, a failure and an unknown differently", () => {
    expect([
      statusGlyph("pass"),
      statusGlyph("fail"),
      statusGlyph("unknown"),
    ]).toEqual(["✓", "✗", "·"]);
  });
});
