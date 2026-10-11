import { describe, expect, it } from "vitest";
import { changedLines, onChangedLines } from "./changed-lines.js";

const BASE = [
  "# Spec",
  "",
  "- FR-001: old rule.",
  "- FR-002: another old rule.",
].join("\n");
const BRANCH = [
  "# Spec",
  "",
  "- FR-001: old rule, reworded.",
  "- FR-002: another old rule.",
  "- FR-003: a new rule.",
].join("\n");

describe("changedLines", () => {
  it("names lines 3 and 5 as changed when the branch reworded FR-001 and added FR-003", () => {
    expect([...changedLines(BRANCH, BASE)]).toEqual([3, 5]);
  });

  it("names every line of a spec the default branch does not have", () => {
    expect([...changedLines(BRANCH, null)]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("onChangedLines", () => {
  it("keeps the finding on line 5 and drops the one on line 4, which the branch did not write", () => {
    const findings = [
      { line: 4, name: "old/path" },
      { line: 5, name: "new/path" },
    ];

    expect(onChangedLines(findings, changedLines(BRANCH, BASE))).toEqual([
      { line: 5, name: "new/path" },
    ]);
  });
});
