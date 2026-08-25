import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssemblyLine } from "./loader.js";
import { getNextTransition, type NodeVisit } from "./transition.js";

/**
 * The implementation loop's per-ticket line (specs/implementation-loop FR3).
 * One run = one ticket; the loop itself is the Floor driver, not a back-edge.
 * The line parks at await-pr (a pr_review human station) until pr-ready-check
 * resumes it, and both resume outcomes close through the same retrospective
 * exit so every ticket ends the same way.
 */
const line = parseAssemblyLine(
  readFileSync(
    join(import.meta.dirname, "assembly-lines/implementation-loop.yaml"),
    "utf8",
  ),
);

const successorsOf = (nodeId: string, on: string) =>
  line.edges.filter((e) => e.from === nodeId && e.on === on).map((e) => e.to);

const visit = (nodeId: string, outcome: string, iteration = 1): NodeVisit => ({
  nodeId,
  iteration,
  outcome: outcome as NodeVisit["outcome"],
});

describe("the implementation-loop line", () => {
  it("walks implement, validate, push, await-pr, retrospective, done on the happy path", () => {
    expect(line.entry).toBe("implement");
    expect(line.exit).toBe("done");
    expect(successorsOf("implement", "success")).toEqual(["validate"]);
    expect(successorsOf("validate", "success")).toEqual(["push"]);
    expect(successorsOf("push", "success")).toEqual(["await-pr"]);
    expect(successorsOf("await-pr", "success")).toEqual(["retrospective"]);
    expect(successorsOf("retrospective", "always")).toEqual(["done"]);
  });

  it("parks await-pr as a pr_review human station routed at the run's pr_url", () => {
    const awaitPr = line.nodes.find((n) => n.id === "await-pr");

    expect(awaitPr).toMatchObject({
      type: "pr_review",
      route: "{args.pr_url}",
    });
  });

  it("drives implement with the implementation-tdd recipe, not the implementation one", () => {
    expect(line.nodes.find((n) => n.id === "implement")).toMatchObject({
      type: "agent",
      prompt_ref: "implementation-tdd",
    });
  });

  it("retries implement once on failed and fails the run on the second failure", () => {
    const retry = line.edges.find(
      (e) => e.from === "implement" && e.to === "implement",
    );

    expect(retry).toMatchObject({ on: "failed", iteration_max: 1 });

    const secondFailure = getNextTransition(line, [
      visit("implement", "failed"),
      visit("implement", "failed", 2),
    ]);

    expect(secondFailure).toMatchObject({
      kind: "fail",
      outcome: "iteration_max",
    });
  });

  it("closes a blocked ticket through the same retrospective exit as a ready one", () => {
    for (const outcome of ["success", "changes_requested", "failed"]) {
      const t = getNextTransition(line, [
        visit("implement", "success"),
        visit("validate", "success"),
        visit("push", "success"),
        visit("await-pr", outcome),
      ]);

      expect(t).toMatchObject({ kind: "launch", nodeId: "retrospective" });
    }
  });

  it("routes implement changes_requested straight to retrospective", () => {
    const t = getNextTransition(line, [
      visit("implement", "changes_requested"),
    ]);

    expect(t).toMatchObject({ kind: "launch", nodeId: "retrospective" });
  });

  it("finishes at done after the retrospective", () => {
    const t = getNextTransition(line, [
      visit("implement", "success"),
      visit("validate", "success"),
      visit("push", "success"),
      visit("await-pr", "success"),
      visit("retrospective", "success"),
    ]);

    expect(t).toEqual({ kind: "finish" });
  });
});
