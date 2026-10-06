import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssemblyLine } from "./loader.js";

const triageLine = parseAssemblyLine(
  readFileSync(
    join(import.meta.dirname, "assembly-lines/issue-triage.yaml"),
    "utf8",
  ),
);

const successorsOf = (nodeId: string, on: string) =>
  triageLine.edges
    .filter((e) => e.from === nodeId && e.on === on)
    .map((e) => e.to);

describe("the issue-triage line", () => {
  it("routes verify (large-issue) to decompose (specs/issue-triage/spec.md#FR6)", () => {
    expect(successorsOf("verify", "large-issue")).toEqual(["decompose"]);
    expect(successorsOf("decompose", "success")).toEqual(["issues"]);
    expect(successorsOf("issues", "success")).toEqual(["done"]);
  });

  it("routes reproduce (success) through triage-label to diagnose (specs/issue-triage/spec.md#FR3)", () => {
    expect(successorsOf("reproduce", "success")).toEqual(["triage-label"]);
  });

  it("covers diagnose (success, failed) edges through triage-label (specs/issue-triage/spec.md#FR3)", () => {
    expect(successorsOf("diagnose", "success")).toEqual(["triage-label"]);
    const failEdge = triageLine.edges.find(
      (e) => e.from === "diagnose" && e.on === "failed",
    );
    expect(failEdge?.to).toBe("triage-label");
    expect(failEdge?.iteration_max).toBe(3);
  });
});
