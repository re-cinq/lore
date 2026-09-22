import { describe, it, expect } from "vitest";
import { canRegenerate, isDraftingPlan, planRunPhase } from "./plan-run-phase";

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
    expect(
      planRunPhase(
        { status: "finished", outcome: "completed", reason: null },
        [],
      ),
    ).toEqual({
      tone: "done",
      text: "Done: the plan's spec-tasks are filed.",
    });
  });
});

describe("planRunPhase on a run that ended without completing", () => {
  it("names the reason of a run finished as iteration_max", () => {
    expect(
      planRunPhase(
        {
          status: "finished",
          outcome: "iteration_max",
          reason: "analyze timed out twice",
        },
        [],
      ),
    ).toEqual({
      tone: "failed",
      text: "The run failed: analyze timed out twice",
    });
  });
});

describe("planRunPhase after a pass that failed", () => {
  it("says the agent's last pass failed while the line waits on its people", () => {
    expect(running(visit("analyze", "failed"), visit("author", null))).toEqual({
      tone: "failed",
      text: "The planning agent's last pass failed. Refine a section or regenerate the plan to ask again.",
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

describe("canRegenerate", () => {
  const regenerable = (status: string, ...nodes: ReturnType<typeof visit>[]) =>
    canRegenerate({ status, reason: null }, nodes);

  it("offers a fresh draft while the line waits on its people at author, and after a failed run", () => {
    expect([
      regenerable(
        "running",
        visit("analyze", "success"),
        visit("author", null),
      ),
      regenerable("failed", visit("analyze", "failed")),
    ]).toEqual([true, true]);
  });

  it("offers no fresh draft while the agent works or once the plan is past approval", () => {
    expect([
      regenerable("running", visit("analyze", null)),
      regenerable("running", visit("author", "success"), visit("write", null)),
      regenerable("running", visit("push", "success"), visit("merged", null)),
    ]).toEqual([false, false, false]);
  });
});
