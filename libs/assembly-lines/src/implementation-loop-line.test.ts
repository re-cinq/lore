import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssemblyLine } from "./loader.js";
import { getNextTransition, type NodeVisit } from "./transition.js";

const line = parseAssemblyLine(
  readFileSync(
    join(import.meta.dirname, "assembly-lines/implementation-loop.yaml"),
    "utf8",
  ),
);

const successorsOf = (nodeId: string, on: string) =>
  line.edges.filter((e) => e.from === nodeId && e.on === on).map((e) => e.to);

const edge = (from: string, to: string) =>
  line.edges.find((e) => e.from === from && e.to === to);

const visit = (nodeId: string, outcome: string, iteration = 1): NodeVisit => ({
  nodeId,
  iteration,
  outcome: outcome as NodeVisit["outcome"],
});

describe("the implementation-loop line", () => {
  it("walks dod, open-pr, tdd-round, ready-for-review, await-pr, retrospective, done", () => {
    expect(line.entry).toBe("dod");
    expect(line.exit).toBe("done");
    expect(successorsOf("dod", "success")).toEqual(["open-pr"]);
    expect(successorsOf("open-pr", "success")).toEqual(["tdd-round"]);
    expect(successorsOf("tdd-round", "success")).toEqual(["ready-for-review"]);
    expect(successorsOf("ready-for-review", "success")).toEqual(["await-pr"]);
    expect(successorsOf("await-pr", "success")).toEqual(["retrospective"]);
    expect(successorsOf("retrospective", "always")).toEqual(["done"]);
  });

  it("gives every agent node an explicit station_ref, since none is named for this line (an agent node's Station otherwise inherits the LINE's task type, and no Station named implementation-loop exists — the first live run died on it)", () => {
    const agents = line.nodes.filter((n) => n.type === "agent");

    expect(agents.map((n) => n.id)).toEqual([
      "dod",
      "open-pr",
      "tdd-round",
      "ready-for-review",
      "fix-ci",
    ]);
    expect(agents.every((n) => n.station_ref)).toBe(true);
  });

  it("opens the pull request through push-only, the one recipe the Floor stamps a PR for (decidePrStamp gates on promptRef === push-only; await-pr's route reads args.pr_url, which only that stamp writes)", () => {
    expect(line.nodes.find((n) => n.id === "open-pr")).toMatchObject({
      prompt_ref: "push-only",
    });
  });

  it("loops tdd-round on changes_requested and leaves on success", () => {
    expect(successorsOf("tdd-round", "changes_requested")).toEqual([
      "tdd-round",
    ]);
    expect(edge("tdd-round", "tdd-round")).toMatchObject({
      on: "changes_requested",
      iteration_max: 12,
    });
  });

  it("gives tdd-round exactly one self-edge, because two would share one budget (iteration_max counters key on `${from}->${to}`, not the outcome)", () => {
    expect(
      line.edges.filter((e) => e.from === "tdd-round" && e.to === "tdd-round"),
    ).toHaveLength(1);
    expect(successorsOf("tdd-round", "failed")).toEqual(["retrospective"]);
  });

  it("sends a red build to fix-ci and back to the wait, not to a blocked ticket", () => {
    expect(successorsOf("await-pr", "changes_requested")).toEqual(["fix-ci"]);
    expect(successorsOf("fix-ci", "success")).toEqual(["await-pr"]);
  });

  it("bounds the CI ping-pong even though a human station exempts the cycle (the loader demands no iteration_max on a human-touching cycle, but the runtime enforces one if declared)", () => {
    expect(edge("await-pr", "fix-ci")).toMatchObject({ iteration_max: 3 });
  });

  it("routes unresolved review threads to a human, not to another build fix", () => {
    expect(successorsOf("await-pr", "failed")).toEqual(["retrospective"]);
  });

  it("parks an unexpressible ticket rather than retrying the definition of done", () => {
    expect(successorsOf("dod", "changes_requested")).toEqual(["retrospective"]);
    expect(edge("dod", "dod")).toMatchObject({
      on: "failed",
      iteration_max: 1,
    });
  });

  it("carries no validate node — lint is what CI runs, and fix-ci repairs it (an in-pod pre-check costs a node:validate claim, the resource whose absence starved five tickets on 2026-08-28, and red CI is no longer terminal)", () => {
    expect(line.nodes.map((n) => n.type)).not.toContain("validate");
  });

  it("replays twelve rounds then fails the run on the thirteenth", () => {
    const rounds: NodeVisit[] = [
      visit("dod", "success"),
      visit("open-pr", "success"),
    ];

    for (let i = 1; i <= 12; i++) {
      rounds.push(visit("tdd-round", "changes_requested", i));
    }
    expect(getNextTransition(line, rounds)).toMatchObject({
      kind: "launch",
      nodeId: "tdd-round",
    });

    rounds.push(visit("tdd-round", "changes_requested", 13));
    expect(getNextTransition(line, rounds)).toMatchObject({
      kind: "fail",
      outcome: "iteration_max",
    });
  });

  it("replays a fix-ci round-trip back onto the wait", () => {
    const visits = [
      visit("dod", "success"),
      visit("open-pr", "success"),
      visit("tdd-round", "success"),
      visit("ready-for-review", "success"),
      visit("await-pr", "changes_requested"),
    ];

    expect(getNextTransition(line, visits)).toMatchObject({
      kind: "launch",
      nodeId: "fix-ci",
    });

    visits.push(visit("fix-ci", "success"));
    expect(getNextTransition(line, visits)).toMatchObject({
      kind: "launch",
      nodeId: "await-pr",
    });
  });

  it("finishes at done after the retrospective", () => {
    expect(
      getNextTransition(line, [
        visit("dod", "success"),
        visit("open-pr", "success"),
        visit("tdd-round", "success"),
        visit("ready-for-review", "success"),
        visit("await-pr", "success"),
        visit("retrospective", "success"),
      ]),
    ).toEqual({ kind: "finish" });
  });
});
