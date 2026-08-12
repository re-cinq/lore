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
import { nextTransition, type NodeVisit } from "./transition.js";
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
      nextTransition(await planning(), [visit("analyze", 1, "success")]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 1 });
  });

  it("waits while the author has the round open", async () => {
    // No outcome yet: the walk must sit still rather than treat the open node as
    // finished. The reaper's wait exemption is what keeps it sitting.
    expect(
      nextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, null),
      ]),
    ).toEqual({ kind: "await" });
  });

  it("runs another round when the author asks for changes", async () => {
    expect(
      nextTransition(await planning(), [
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

    expect(nextTransition(line, visits)).toEqual({
      kind: "launch",
      nodeId: "analyze",
      iteration: 26,
    });
  });

  it("moves on when the author accepts the plan", async () => {
    // `done` is the exit, so the walk settles rather than launching it. Stage 2
    // retargets this edge at spec analysis, and then it becomes a launch.
    expect(
      nextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, "success"),
      ]),
    ).toEqual({ kind: "finish" });
  });

  it("ends the line when the author abandons the feature", async () => {
    expect(
      nextTransition(await planning(), [
        visit("analyze", 1, "success"),
        visit("author", 1, "failed"),
      ]),
    ).toEqual({ kind: "finish" });
  });

  it("numbers the second round's nodes 2, so its rows cannot collide with the first", async () => {
    // A node's storage identity is (nodeId, iteration), and the Agent CR name is
    // derived from it. Reusing iteration 1 for round 2 would collide on both.
    expect(
      nextTransition(await planning(), [
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
      nextTransition(await planning(), [
        visit("analyze", 1, "changes_requested"),
      ]),
    ).toEqual({ kind: "launch", nodeId: "author", iteration: 1 });
  });
});
