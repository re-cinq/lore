import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssemblyLine } from "./loader.js";

/**
 * The merge line's whole point is that one step failing does not skip the rest.
 * That is a property of its EDGES, so it is asserted on the blueprint rather than
 * left to the reader — the code it replaces got this wrong in a way no test saw.
 */
const merge = parseAssemblyLine(
  readFileSync(join(import.meta.dirname, "assembly-lines/merge.yaml"), "utf8"),
);

const successorsOf = (nodeId: string, on: string) =>
  merge.edges.filter((e) => e.from === nodeId && e.on === on).map((e) => e.to);

describe("the merge line", () => {
  it("carries every step the merged-PR handler did", () => {
    expect(merge.nodes.map((n) => n.id)).toEqual([
      "settle",
      "spec-status",
      "close-issue",
      "outcome-stats",
      "curate",
      "memory-feedback",
      "trust",
      "spec-tasks",
      "resume-planning",
      "done",
    ]);
  });

  it("routes a failed step FORWARD, so one failure cannot skip the steps after it", () => {
    const skipped = merge.nodes
      .filter((n) => n.id !== "settle" && n.id !== "done")
      .filter((n) => {
        const [onSuccess] = successorsOf(n.id, "success");
        const [onFailed] = successorsOf(n.id, "failed");

        return onFailed !== onSuccess;
      })
      .map((n) => n.id);

    expect(skipped).toEqual([]);
  });

  it("ends the line when the settle fails, since nothing after it is meaningful", () => {
    expect(successorsOf("settle", "failed")).toEqual(["done"]);
  });

  it("gives every step its own job_ref, so the station knows which one it is", () => {
    const steps = merge.nodes.filter((n) => n.type === "merge_step");

    expect(steps.map((n) => n.job_ref)).toEqual(steps.map((n) => n.id));
  });
});
