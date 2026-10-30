import { describe, it, expect } from "vitest";
import { reportWithHistory } from "./report-history.js";
import type { TestReportRow } from "./test-reports-port.js";

const reportedTest = (file: string, name: string) => ({
  id: `${file}::${name}`,
  name,
  file,
});

function row(
  commit: string,
  receivedAt: number,
  tests: ReturnType<typeof reportedTest>[],
): TestReportRow {
  return {
    id: String(receivedAt),
    repo: "o/r",
    commit,
    branch: "main",
    tests,
    outcomes: Object.fromEntries(tests.map(({ id }) => [id, true])),
    receivedAt: new Date(receivedAt * 1000),
  };
}

function failing(passing: TestReportRow): TestReportRow {
  return {
    ...passing,
    outcomes: Object.fromEntries(
      Object.keys(passing.outcomes).map((id) => [id, false]),
    ),
  };
}

describe("reportWithHistory", () => {
  it("keeps the files the head commit ran and adds the files only an earlier commit ran", () => {
    const head = row("head", 30, [reportedTest("a.test.ts", "adds")]);
    const earlier = [row("mid", 20, [reportedTest("b.test.ts", "subtracts")])];

    expect(reportWithHistory(head, earlier)).toMatchObject({
      commit: "head",
      tests: [
        reportedTest("a.test.ts", "adds"),
        reportedTest("b.test.ts", "subtracts"),
      ],
      outcomes: { "a.test.ts::adds": true, "b.test.ts::subtracts": true },
    });
  });

  it("takes a file from the newest earlier commit that ran it", () => {
    const head = failing(row("head", 30, [reportedTest("a.test.ts", "adds")]));
    const earlier = [
      failing(row("mid", 20, [reportedTest("b.test.ts", "subtracts")])),
      row("first", 10, [reportedTest("b.test.ts", "subtracts")]),
    ];

    expect(reportWithHistory(head, earlier)).toMatchObject({
      outcomes: { "a.test.ts::adds": false, "b.test.ts::subtracts": false },
    });
  });

  it("returns the head report unchanged when nothing earlier ran another file", () => {
    const head = row("head", 30, [reportedTest("a.test.ts", "adds")]);

    expect(
      reportWithHistory(head, [
        failing(row("old", 10, [reportedTest("a.test.ts", "adds")])),
      ]),
    ).toEqual(head);
  });
});
