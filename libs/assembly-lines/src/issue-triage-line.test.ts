import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssemblyLine } from "./loader.js";

const triage = parseAssemblyLine(
  readFileSync(
    join(import.meta.dirname, "assembly-lines/issue-triage.yaml"),
    "utf8",
  ),
);

const successorsOf = (nodeId: string, on: string) =>
  triage.edges.filter((e) => e.from === nodeId && e.on === on).map((e) => e.to);

describe("the issue-triage line (specs/issue-triage/spec.md#User Story 2 - Root Cause Diagnosis and Spec Verification (Priority: P1))", () => {
  it("transitions to diagnose after a successful reproduce", () => {
    expect(successorsOf("reproduce", "success")).toEqual(["diagnose"]);
  });
});
