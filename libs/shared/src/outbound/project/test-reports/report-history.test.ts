import { describe, it, expect } from "vitest";
import { reportWithHistory } from "./report-history.js";
import type { TestReportRow } from "./test-reports-port.js";

const test = (file: string, name: string) => ({
  id: `${file}::${name}`,
  name,
  file,
});

function row(
  commit: string,
  receivedAt: number,
  tests: ReturnType<typeof test>[],
  passed = true,
): TestReportRow {
  return {
    id: String(receivedAt),
    repo: "o/r",
    commit,
    branch: "main",
    tests,
    outcomes: Object.fromEntries(tests.map(({ id }) => [id, passed])),
    receivedAt: new Date(receivedAt * 1000),
  };
}

describe("reportWithHistory", () => {
  it("keeps the files the head commit ran and adds the files only an earlier commit ran", () => {
    const head = row("head", 30, [test("a.test.ts", "adds")]);
    const earlier = [row("mid", 20, [test("b.test.ts", "subtracts")])];

    expect(reportWithHistory(head, earlier)).toMatchObject({
      commit: "head",
      tests: [test("a.test.ts", "adds"), test("b.test.ts", "subtracts")],
      outcomes: { "a.test.ts::adds": true, "b.test.ts::subtracts": true },
    });
  });

  it("takes a file from the newest earlier commit that ran it", () => {
    const head = row("head", 30, [test("a.test.ts", "adds")], false);
    const earlier = [
      row("mid", 20, [test("b.test.ts", "subtracts")], false),
      row("first", 10, [test("b.test.ts", "subtracts")], true),
    ];

    expect(reportWithHistory(head, earlier)).toMatchObject({
      outcomes: { "a.test.ts::adds": false, "b.test.ts::subtracts": false },
    });
  });

  it("returns the head report unchanged when nothing earlier ran another file", () => {
    const head = row("head", 30, [test("a.test.ts", "adds")]);

    expect(
      reportWithHistory(head, [
        row("old", 10, [test("a.test.ts", "adds")], false),
      ]),
    ).toEqual(head);
  });
});
