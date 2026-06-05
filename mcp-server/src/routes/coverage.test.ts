import { describe, it, expect } from "vitest";
import { parseLcov, parseCobertura } from "./coverage.js";

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
