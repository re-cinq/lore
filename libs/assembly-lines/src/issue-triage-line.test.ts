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
    expect(successorsOf("decompose", "always")).toEqual(["done"]);
  });
});
