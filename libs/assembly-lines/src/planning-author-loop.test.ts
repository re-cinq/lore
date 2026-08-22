// The planning line's author loop: the round the human works is a NODE.
//
// Before this, a feature's life was one line per round with nothing between them —
// the moments a person acts (refine, accept) were gaps the machinery could not see
// or draw. The `author` wait node makes the pause a first-class part of the graph,
// so the walk that resumes after feedback is the same walk that dispatched the pod.
//
// These are pure replays over the persisted-visit list: no pod, no database.

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
  it("parks on the author after a round is produced", async () => {
    // The line does NOT finish when the agent succeeds — it hands over to the
    // person. A line that ended here is the old one-line-per-round shape.
    expect(
      getNextTransition(await planning(), [visit("analyze", 1, "success")]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 1 });
  });

  it("waits while the author has the round open", async () => {
    // No outcome yet: the walk must sit still rather than treat the open node as
    // finished. The reaper's wait exemption is what keeps it sitting.
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

  it("refines round after round without exhausting a budget", async () => {
    // The point of the human-gated exemption: a person decides every pass, so there
    // is no runaway to bound. A numeric cap here would silently kill a feature that
    // simply took a lot of conversation.
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

  it("moves on when the author accepts the plan", async () => {
    // Accepting no longer ends the line: the spec work follows on the SAME line.
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

  it("numbers the second round's nodes 2, so its rows cannot collide with the first", async () => {
    // A node's storage identity is (nodeId, iteration), and the Agent CR name is
    // derived from it. Reusing iteration 1 for round 2 would collide on both.
    expect(
      getNextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, "changes_requested"),
        visit("analyze", 2, "success"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 2 });
  });

  it("still parks on the author when the agent reports changes_requested", async () => {
    // An agent node can produce this outcome, so the graph must route it; planning
    // asks for no review, so it reaches the author exactly as success does.
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

  it("sends the plan back to the AUTHOR when the analysis has a question", async () => {
    // The analysis has no upstream node — its input is a plan a person accepted, so
    // the only party who can answer is that person. Before the merged line this ended
    // the line and settle-task faked a task failure to surface the objection; now it
    // is an ordinary edge to the station whose worker is the author.
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

  it("fails the line rather than let write and analyse argue twice", async () => {
    // Two agents disagreeing without a referee will do so all day. The author's own
    // loop is unbounded because a person decides each pass; this one is not.
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

  it("runs one line from the first round to the pushed spec PR", async () => {
    // The whole point: one line id spans refine → accept → analyse → write → push.
    //
    // The nodes after the loop carry iteration 2, not 1: `iteration` is a WALK-level
    // counter, so once the author's back-edge bumps it every later node inherits the
    // number even on its first visit. Harmless for identity — (nodeId, iteration) is
    // still unique — but it is why a first-ever `write` row can read as iteration 7
    // on a feature that took six rounds.
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
  it("points analyse-specs and write at their own Stations, not the line's", async () => {
    // The Station carries the RECIPE — its prompt template and, decisively, its
    // `output.watch`. An agent node with no `station_ref` resolves the Station named
    // after the line's task type, so on the merged line every node ran
    // feature-planning's recipe: analyse-specs and write both executed the PLANNING
    // prompt and emitted planning results, push found nothing to commit, and no spec
    // PR was ever opened — while every node reported success.
    const nodes = new Map(
      (await planning()).nodes.map((n) => [n.id, n.station_ref]),
    );

    // push too: it inherits the LINE's task type, which on the merged line is
    // feature-planning — so the node meant to commit and push would run the planning
    // prompt. The API's `stationInherited` is what made this visible.
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
  // The decomposition tail. It used to be a SECOND line, started by minting a
  // `feature-decompose` task when the spec PR merged — a predicate that
  // stopped matching the moment finalize became a resume of this line, so nothing
  // decomposed and nothing said so. Merging the tail in makes the merge a node
  // outcome like any other.
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

  it("waits while the spec PR is open", async () => {
    // The person reviewing the spec PR is this node's worker, exactly as the author
    // is the `author` node's. An open PR is not a stalled line.
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

  it("sends a change request on the spec PR back to the author", async () => {
    // A reviewer objecting to the spec is an objection to a plan a PERSON accepted,
    // so only that person can answer it — the same reasoning that routes the spec
    // analysis's question to the author instead of ending the line.
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 2 });
  });

  it("ends the line when the spec PR is closed without merging", async () => {
    // Not a failure of the machine — the feature was abandoned or superseded. It
    // still needs an edge, because selectEdge does not fall through.
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

  it("ends the line when the spec cannot be decomposed", async () => {
    // decompose has no upstream NODE — its input is a spec a human merged, so a spec
    // it cannot break down is a question for the author, not something to re-run.
    expect(
      getNextTransition(await planning(), [
        ...pushed,
        visit("merged", 1, "success"),
        visit("decompose", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "finish" });
  });

  it("returns a decomposition the repo cannot accept to the agent, once", async () => {
    // The station is the first thing to read the decomposition as DATA, so it is
    // where a label the repo does not have actually shows. It sends the artifact
    // back rather than letting GitHub CREATE an invented label on the spot.
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

  it("runs one line from the first round to the filed issues", async () => {
    // The whole lifecycle under one line id: refine, accept, analyse, write, push,
    // wait for the merge, decompose, file. Nothing here starts a second run — which
    // is the entire point, since the old shape needed a fresh task at the merge and
    // that task was never created.
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
