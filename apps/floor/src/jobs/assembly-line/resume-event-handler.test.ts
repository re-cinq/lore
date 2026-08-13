import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import { createResumeEventHandler } from "./resume-event-handler.js";

/** Records what the handler did, so the test asserts the PATH, not a mock's shape. */
function harness() {
  const lines = new InMemoryAssemblyLines();
  const finished: Array<{
    assemblyLineId: string;
    nodeId: string;
    iteration?: number;
    outcome: string;
  }> = [];
  const handler = createResumeEventHandler({
    assemblyLines: lines,
    finishNodeAndAdvance: async (input) => {
      finished.push({
        assemblyLineId: input.assemblyLineId,
        nodeId: input.nodeId,
        iteration: input.iteration,
        outcome: input.result.outcome,
      });
    },
  });

  return { lines, finished, handler };
}

const params = (over: Record<string, unknown> = {}) => ({
  assemblyLineId: "11111111-2222-3333-4444-555555555555",
  nodeId: "author",
  iteration: 1,
  outcome: "changes_requested",
  ...over,
});

describe("createResumeEventHandler", () => {
  it("records the outcome and advances, the same path a pod's outcome takes", async () => {
    // The point of the whole design: a station reporting from a browser and a station
    // reporting from a pod converge here. If this ever forks, the human node stops
    // being a station and becomes a special case.
    const { handler, finished } = harness();

    await handler(params());

    expect(finished).toEqual([
      {
        assemblyLineId: "11111111-2222-3333-4444-555555555555",
        nodeId: "author",
        iteration: 1,
        outcome: "changes_requested",
      },
    ]);
  });

  it("carries the author's feedback into the line before advancing", async () => {
    // The next analyze node reads its brief from args, exactly as it reads
    // args.description — the objection channel, reused rather than reinvented.
    const { handler, lines } = harness();
    const id = await lines.start({
      definitionName: "feature",
      repo: "re-cinq/lore",
      args: { description: "d" },
    });

    await handler(
      params({
        assemblyLineId: id,
        args: { round_feedback: "<RoundFeedback/>" },
      }),
    );

    expect((await lines.getById(id))?.args).toMatchObject({
      description: "d",
      round_feedback: "<RoundFeedback/>",
    });
  });

  it("accepts the author approving the plan", async () => {
    const { handler, finished } = harness();

    await handler(params({ outcome: "success" }));

    expect(finished[0].outcome).toBe("success");
  });

  it("refuses an outcome the station contract does not define", async () => {
    // A typo'd outcome would route down an edge nobody wrote, or none at all.
    const { handler } = harness();

    await expect(handler(params({ outcome: "approved" }))).rejects.toThrow(
      /outcome/,
    );
  });

  it("refuses an event with no line to resume", async () => {
    const { handler } = harness();

    await expect(handler(params({ assemblyLineId: "" }))).rejects.toThrow(
      /assemblyLineId/,
    );
  });

  it("refuses an event that names no node", async () => {
    // Without the node there is nothing to complete: the line may be parked on any
    // of several waits, and guessing would resume the wrong one.
    const { handler } = harness();

    await expect(handler(params({ nodeId: "" }))).rejects.toThrow(/nodeId/);
  });
});
