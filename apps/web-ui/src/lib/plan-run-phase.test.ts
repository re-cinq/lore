import { describe, it, expect } from "vitest";
import { isDraftingPlan, planRunPhase } from "./plan-run-phase";

const visit = (nodeId: string, outcome: string | null, iteration = 1) => ({
  nodeId,
  iteration,
  outcome,
});
const running = (...nodes: ReturnType<typeof visit>[]) =>
  planRunPhase({ status: "running", reason: null }, nodes);

describe("planRunPhase", () => {
  it("says a queued run waits for a runner to pick up the draft", () => {
    expect(planRunPhase({ status: "queued", reason: null }, [])).toEqual({
      tone: "waiting",
      text: "Waiting for a runner to pick up the draft.",
    });
  });

  it("says the agent is drafting while the first analyze visit runs", () => {
    expect(running(visit("analyze", null))).toEqual({
      tone: "working",
      text: "The planning agent is drafting the plan.",
    });
  });

  it("says the agent is refining once analyze runs again after a Refine", () => {
    expect(
      running(
        visit("analyze", "success"),
        visit("author", "changes_requested"),
        visit("analyze", null, 2),
      ),
    ).toMatchObject({
      text: "The planning agent is refining a section.",
    });
  });

  it("says the plan waits for its people while the author node is parked", () => {
    expect(running(visit("analyze", "success"), visit("author", null))).toEqual(
      {
        tone: "waiting",
        text: "Waiting for you: refine sections or approve the plan.",
      },
    );
  });

  it("says the specs are being written from the approved plan", () => {
    expect(
      running(visit("author", "success"), visit("write", null)),
    ).toMatchObject({
      tone: "working",
      text: "Writing the specs from the approved plan.",
    });
  });

  it("says the spec PR waits to merge while the merged node is parked", () => {
    expect(running(visit("push", "success"), visit("merged", null))).toEqual({
      tone: "waiting",
      text: "The spec PR is open and waiting to be merged.",
    });
  });

  it("says the spec is being broken into stories and tasks during issues", () => {
    expect(
      running(visit("decompose", "success"), visit("issues", null)),
    ).toMatchObject({
      text: "Breaking the spec into stories and tasks.",
    });
  });

  it("names the reason a failed run gave", () => {
    expect(
      planRunPhase({ status: "failed", reason: "analyze timed out" }, []),
    ).toEqual({
      tone: "failed",
      text: "The run failed: analyze timed out",
    });
  });

  it("says a finished run filed the plan's spec-tasks", () => {
    expect(planRunPhase({ status: "finished", reason: null }, [])).toEqual({
      tone: "done",
      text: "Done: the plan's spec-tasks are filed.",
    });
  });
});

describe("isDraftingPlan", () => {
  const drafting = (status: string, ...nodes: ReturnType<typeof visit>[]) =>
    isDraftingPlan({ status }, nodes);

  it("holds the plan while the run is queued, started or on its first analyze", () => {
    expect([
      drafting("queued"),
      drafting("running"),
      drafting("running", visit("analyze", null)),
    ]).toEqual([true, true, true]);
  });

  it("opens the plan once the draft is written, while a section is refined, and when the run failed", () => {
    expect([
      drafting("running", visit("analyze", "success"), visit("author", null)),
      drafting(
        "running",
        visit("analyze", "success"),
        visit("author", "changes_requested"),
        visit("analyze", null, 2),
      ),
      drafting("failed", visit("analyze", "failed")),
    ]).toEqual([false, false, false]);
  });
});
