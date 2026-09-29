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

  it("includes a diagnose node that instruments the codebase to trace root causes", () => {
    const diagnoseNode = triage.nodes.find((n) => n.id === "diagnose");
    expect(diagnoseNode).toBeDefined();
    expect(diagnoseNode?.description).toContain("trace the root cause");
    expect(successorsOf("diagnose", "success")).toEqual(["verify"]);
    expect(successorsOf("diagnose", "failed")).toEqual(["done"]);
  });
});
