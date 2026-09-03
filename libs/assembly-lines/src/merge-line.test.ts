import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssemblyLine } from "./loader.js";
import { getNextTransition, type NodeVisit } from "./transition.js";
import type { StageOutcome } from "./node-types.js";

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

describe("the merge line actually walks", () => {
  function walk(
    answer: (nodeId: string) => StageOutcome,
    limit = 40,
  ): { visited: string[]; finished: boolean } {
    const visits: NodeVisit[] = [];
    const visited: string[] = [];

    for (let step = 0; step < limit; step++) {
      const t = getNextTransition(merge, visits);

      if (t.kind === "finish" || t.kind === "fail") {
        return { visited, finished: true };
      }

      if (t.kind !== "launch") {
        return { visited, finished: false };
      }
      visited.push(t.nodeId);
      visits.push({
        nodeId: t.nodeId,
        iteration: t.iteration,
        outcome: answer(t.nodeId),
      });
    }

    return { visited, finished: false };
  }

  it("visits all nine steps in order and terminates when each succeeds", () => {
    const { visited, finished } = walk(() => "success");

    expect(finished).toBe(true);
    expect(visited).toEqual([
      "settle",
      "spec-status",
      "close-issue",
      "outcome-stats",
      "curate",
      "memory-feedback",
      "trust",
      "spec-tasks",
      "resume-planning",
    ]);
  });

  it("still reaches resume-planning when trust fails, which is the defect the line exists to fix", () => {
    const { visited, finished } = walk((id) =>
      id === "trust" ? "failed" : "success",
    );

    expect(finished).toBe(true);
    expect(visited).toContain("resume-planning");
  });

  it("stops after settle when settle fails, since nothing downstream is meaningful", () => {
    const { visited, finished } = walk((id) =>
      id === "settle" ? "failed" : "success",
    );

    expect(finished).toBe(true);
    expect(visited).toEqual(["settle"]);
  });
});
