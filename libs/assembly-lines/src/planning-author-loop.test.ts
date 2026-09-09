import { describe, it, expect } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { getNextTransition, type NodeVisit } from "./transition.js";
import { loadBuiltinAssemblyLines } from "./builtin-assembly-lines.js";
import type { AssemblyLine } from "./loader.js";

const planning = async (): Promise<AssemblyLine> => {
  const line = (await loadBuiltinAssemblyLines()).get("feature-planning");

  enforceTrue(line !== undefined, Error, "feature-planning definition missing");

  return line;
};

const visit = (
  nodeId: string,
  iteration: number,
  outcome: NodeVisit["outcome"],
): NodeVisit => ({ nodeId, iteration, outcome });

describe("feature-planning author loop", () => {
  it("parks on the author after a round is produced (the line does NOT finish when the agent succeeds — it hands over to the person)", async () => {
    expect(
      getNextTransition(await planning(), [visit("analyze", 1, "success")]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 1 });
  });

  it("waits while the author has the round open (the reaper's wait exemption keeps it sitting rather than treating the open node as finished)", async () => {
    expect(
      getNextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, null),
      ]),
    ).toEqual({ kind: "await" });
  });

  it("runs another round when the author asks for changes", async () => {
    expect(
      getNextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "analyze", iteration: 2 });
  });

  it("refines round after round without exhausting a budget (a person decides every pass, so a numeric cap would silently kill a feature that took a lot of conversation)", async () => {
    const line = await planning();
    const visits: NodeVisit[] = [];

    for (let round = 1; round <= 25; round += 1) {
      visits.push(visit("analyze", round, "success"));
      visits.push(visit("author", round, "changes_requested"));
    }

    expect(getNextTransition(line, visits)).toEqual({
      kind: "launch",
      nodeId: "analyze",
      iteration: 26,
    });
  });

  it("moves on when the author accepts the plan (accepting no longer ends the line — the spec work follows on the SAME line)", async () => {
    expect(
      getNextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, "success"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "analyse-specs", iteration: 1 });
  });

  it("ends the line when the author abandons the feature", async () => {
    expect(
      getNextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, "failed"),
      ]),
    ).toEqual({ kind: "finish" });
  });

  it("numbers the second round's nodes 2, so its rows cannot collide with the first (a node's storage identity is (nodeId, iteration), and the Agent CR name derives from it)", async () => {
    expect(
      getNextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, "changes_requested"),
        visit("analyze", 2, "success"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 2 });
  });

  it("still parks on the author when the agent reports changes_requested (planning asks for no review, so it reaches the author exactly as success does)", async () => {
    expect(
      getNextTransition(await planning(), [
        visit("analyze", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 1 });
  });
});

describe("feature-planning after the author accepts", () => {
  const accepted: NodeVisit[] = [
    visit("analyze", 1, "success"),
    visit("author", 1, "success"),
  ];

  it("analyses which specs change before anything writes one", async () => {
    expect(getNextTransition(await planning(), accepted)).toEqual({
      kind: "launch",
      nodeId: "analyse-specs",
      iteration: 1,
    });
  });

  it("sends the plan back to the AUTHOR when the analysis has a question (its input is a plan a person accepted, so only that person can answer; previously settle-task faked a task failure to surface this)", async () => {
    expect(
      getNextTransition(await planning(), [
        ...accepted,
        visit("analyse-specs", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 2 });
  });

  it("writes the specs once the analysis lands", async () => {
    expect(
      getNextTransition(await planning(), [
        ...accepted,
        visit("analyse-specs", 1, "success"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "write", iteration: 1 });
  });

  it("returns an unusable change set to the analysis, once", async () => {
    expect(
      getNextTransition(await planning(), [
        ...accepted,
        visit("analyse-specs", 1, "success"),
        visit("write", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "analyse-specs", iteration: 2 });
  });

  it("fails the line rather than let write and analyse argue twice (unlike the author's person-gated loop, two agents disagreeing without a referee would do so all day)", async () => {
    expect(
      getNextTransition(await planning(), [
        ...accepted,
        visit("analyse-specs", 1, "success"),
        visit("write", 1, "changes_requested"),
        visit("analyse-specs", 2, "success"),
        visit("write", 2, "changes_requested"),
      ]),
    ).toMatchObject({ kind: "fail", outcome: "iteration_max" });
  });

  it("pushes the branch so the watcher opens the spec PR", async () => {
    expect(
      getNextTransition(await planning(), [
        ...accepted,
        visit("analyse-specs", 1, "success"),
        visit("write", 1, "success"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "push", iteration: 1 });
  });

  it("runs one line from the first round to the pushed spec PR (one line id spans refine→accept→analyse→write→push; nodes after the loop inherit iteration 2 since `iteration` is a WALK-level counter, harmless for identity since (nodeId, iteration) stays unique)", async () => {
    expect(
      getNextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, "changes_requested"),
        visit("analyze", 2, "success"),
        visit("author", 2, "success"),
        visit("analyse-specs", 2, "success"),
        visit("write", 2, "success"),
        visit("push", 2, "success"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "merged", iteration: 2 });
  });
});

describe("the merged line's agent nodes name their own recipes", () => {
  it("points analyse-specs and write at their own Stations, not the line's (without station_ref every node on the merged line would run feature-planning's recipe — push too, via inherited task type — reporting success while doing nothing real; stationInherited is what made this visible)", async () => {
    const nodes = new Map(
      (await planning()).nodes.map((n) => [n.id, n.station_ref]),
    );

    expect({
      analyse: nodes.get("analyse-specs"),
      write: nodes.get("write"),
      push: nodes.get("push"),
    }).toEqual({
      analyse: "spec-analysis",
      write: "spec-write",
      push: "spec-write",
    });
  });
});

describe("feature-planning after the spec PR is pushed", () => {
  const pushed: NodeVisit[] = [
    visit("analyze", 1, "success"),
    visit("author", 1, "success"),
    visit("analyse-specs", 1, "success"),
    visit("write", 1, "success"),
    visit("push", 1, "success"),
  ];

  it("parks on the merged node once the branch is pushed", async () => {
    expect(getNextTransition(await planning(), pushed)).toEqual({
      kind: "launch",
      nodeId: "merged",
      iteration: 1,
    });
  });

  it("waits while the spec PR is open (the reviewer is this node's worker, exactly as the author is the author node's; an open PR is not a stalled line)", async () => {
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, null),
      ]),
    ).toEqual({ kind: "await" });
  });

  it("decomposes the spec once the PR merges", async () => {
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "success"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "decompose", iteration: 1 });
  });

  it("sends a change request on the spec PR back to the author (an objection to a plan a PERSON accepted, so only that person can answer it)", async () => {
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 2 });
  });

  it("ends the line when the spec PR is closed without merging (not a machine failure — the feature was abandoned or superseded, but it still needs an edge since selectEdge does not fall through)", async () => {
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "failed"),
      ]),
    ).toEqual({ kind: "finish" });
  });

  it("files the issues once the decomposition lands", async () => {
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "success"),
        visit("decompose", 1, "success"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "issues", iteration: 1 });
  });

  it("ends the line when the spec cannot be decomposed (its input is a spec a human merged, so a spec it cannot break down is a question for the author, not something to re-run)", async () => {
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "success"),
        visit("decompose", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "finish" });
  });

  it("returns a decomposition the repo cannot accept to the agent, once (the station is the first thing to read the decomposition as DATA, so a missing label shows there — sent back rather than letting GitHub invent it)", async () => {
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "success"),
        visit("decompose", 1, "success"),
        visit("issues", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "decompose", iteration: 2 });
  });

  it("fails the line rather than let issues and decompose argue twice", async () => {
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "success"),
        visit("decompose", 1, "success"),
        visit("issues", 1, "changes_requested"),
        visit("decompose", 2, "success"),
        visit("issues", 2, "changes_requested"),
      ]),
    ).toMatchObject({ kind: "fail", outcome: "iteration_max" });
  });

  it("finishes once the issues are filed", async () => {
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "success"),
        visit("decompose", 1, "success"),
        visit("issues", 1, "success"),
      ]),
    ).toEqual({ kind: "finish" });
  });

  it("runs one line from the first round to the filed issues (nothing here starts a second run — the old shape needed a fresh task at the merge that was never created)", async () => {
    expect(
      getNextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, "changes_requested"),
        visit("analyze", 2, "success"),
        visit("author", 2, "success"),
        visit("analyse-specs", 2, "success"),
        visit("write", 2, "success"),
        visit("push", 2, "success"),
        visit("merged", 2, "success"),
        visit("decompose", 2, "success"),
        visit("issues", 2, "success"),
      ]),
    ).toEqual({ kind: "finish" });
  });
});
