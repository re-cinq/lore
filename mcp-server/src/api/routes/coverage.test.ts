import { describe, it, expect } from "vitest";
import { parseLcov, parseCobertura, parseLcovGroups } from "./coverage.js";

describe("parseLcov", () => {
  it("returns a length-1 range for one covered line", () => {
    const lcov = "SF:src/runner.ts\nDA:42,1\nend_of_record\n";
    expect(parseLcov(lcov)).toEqual([
      { file: "src/runner.ts", startLine: 42, endLine: 42 },
    ]);
  });

  it("collapses three contiguous covered lines into one range", () => {
    const lcov = "SF:src/runner.ts\nDA:10,1\nDA:11,1\nDA:12,1\nend_of_record\n";
    expect(parseLcov(lcov)).toEqual([
      { file: "src/runner.ts", startLine: 10, endLine: 12 },
    ]);
  });

  it("attributes each chunk to its own SF record across two files", () => {
    const lcov =
      "SF:src/a.ts\nDA:1,1\nend_of_record\nSF:src/b.ts\nDA:5,1\nend_of_record\n";
    expect(parseLcov(lcov)).toEqual([
      { file: "src/a.ts", startLine: 1, endLine: 1 },
      { file: "src/b.ts", startLine: 5, endLine: 5 },
    ]);
  });
});

describe("parseLcovGroups", () => {
  it("keys the group by TN and collapses contiguous lines into one range", () => {
    const lcov =
      "TN:claims pending task\nSF:src/runner.ts\nDA:42,1\nDA:43,1\nend_of_record\n";
    expect(parseLcovGroups(lcov)).toEqual([
      {
        test: "claims pending task",
        covered: [{ file: "src/runner.ts", startLine: 42, endLine: 43 }],
      },
    ]);
  });

  it("merges two records sharing a TN into one group concatenating both files' chunks", () => {
    const lcov =
      "TN:my test\nSF:src/a.ts\nDA:1,1\nend_of_record\nTN:my test\nSF:src/b.ts\nDA:5,1\nend_of_record\n";
    expect(parseLcovGroups(lcov)).toEqual([
      {
        test: "my test",
        covered: [
          { file: "src/a.ts", startLine: 1, endLine: 1 },
          { file: "src/b.ts", startLine: 5, endLine: 5 },
        ],
      },
    ]);
  });

  it("falls back to a per-file group keyed by SF when TN is absent", () => {
    const lcov = "SF:src/a.ts\nDA:1,1\nDA:2,1\nend_of_record\n";
    expect(parseLcovGroups(lcov)).toEqual([
      {
        test: "src/a.ts",
        covered: [{ file: "src/a.ts", startLine: 1, endLine: 2 }],
      },
    ]);
  });
});

describe("parseCobertura", () => {
  it("collapses contiguous covered lines per class into ranges", () => {
    const xml = `<coverage>
 <packages><package><classes>
  <class filename="src/a.ts"><lines>
   <line number="10" hits="3"/>
   <line number="11" hits="1"/>
   <line number="20" hits="2"/>
  </lines></class>
 </classes></package></packages>
</coverage>`;
    expect(parseCobertura(xml)).toEqual([
      { file: "src/a.ts", startLine: 10, endLine: 11 },
      { file: "src/a.ts", startLine: 20, endLine: 20 },
    ]);
  });
});
