import { describe, it, expect } from "vitest";
import { coveredRanges } from "./covered-ranges.js";

const ROOT = "/repo";

function fileCoverage(
  path: string,
  statements: Array<[number, number, number]>,
) {
  return {
    path,
    statementMap: Object.fromEntries(
      statements.map(([start, end], i) => [
        String(i),
        { start: { line: start }, end: { line: end } },
      ]),
    ),
    s: Object.fromEntries(statements.map(([, , hits], i) => [String(i), hits])),
  };
}

describe("coveredRanges", () => {
  it("returns the repo-relative line range of every statement that ran", () => {
    const report = {
      "/repo/libs/shared/src/a.ts": fileCoverage("/repo/libs/shared/src/a.ts", [
        [1, 3, 2],
        [5, 5, 0],
        [7, 9, 1],
      ]),
    };

    expect(coveredRanges(report, ROOT)).toEqual([
      { file: "libs/shared/src/a.ts", startLine: 1, endLine: 3 },
      { file: "libs/shared/src/a.ts", startLine: 7, endLine: 9 },
    ]);
  });

  it("drops test files and files outside a package's src", () => {
    const report = {
      a: fileCoverage("/repo/libs/shared/src/a.test.ts", [[1, 1, 1]]),
      b: fileCoverage("/repo/apps/web-ui/src/B.test.tsx", [[1, 1, 1]]),
      c: fileCoverage("/repo/tools/vitest/workspace-source.ts", [[1, 1, 1]]),
      d: fileCoverage("/repo/apps/stations/src/d.ts", [[4, 6, 3]]),
    };

    expect(coveredRanges(report, ROOT)).toEqual([
      { file: "apps/stations/src/d.ts", startLine: 4, endLine: 6 },
    ]);
  });

  it("reports a range two statements share once", () => {
    const report = {
      a: fileCoverage("/repo/libs/shared/src/a.ts", [
        [2, 2, 1],
        [2, 2, 4],
      ]),
    };

    expect(coveredRanges(report, ROOT)).toEqual([
      { file: "libs/shared/src/a.ts", startLine: 2, endLine: 2 },
    ]);
  });
});
