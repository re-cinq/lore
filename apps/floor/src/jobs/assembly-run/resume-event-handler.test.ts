import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { createResumeEventHandler } from "./resume-event-handler.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";

/** Records what the handler did, so the test asserts the PATH, not a mock's shape. */
function harness() {
  const lines = new InMemoryAssemblyRuns();
  const finished: Array<{
    assemblyLineId: string;
    nodeId: string;
    iteration?: number;
    outcome: string;
    result: NodeResult;
  }> = [];
  const handler = createResumeEventHandler({
    assemblyRuns: lines,
    finishNodeAndAdvance: async (input) => {
      finished.push({
        assemblyLineId: input.assemblyLineId,
        nodeId: input.nodeId,
        iteration: input.iteration,
        outcome: input.result.outcome,
        result: input.result,
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
        result: { outcome: "changes_requested" },
      },
    ]);
  });

  it("carries the author's feedback into the line before advancing", async () => {
    // The next analyze node reads its brief from args, exactly as it reads
    // args.description — the objection channel, reused rather than reinvented.
    const { handler, lines } = harness();
    const id = await lines.start({
      blueprintName: "feature",
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
      /assemblyRunId/,
    );
  });

  it("refuses an event that names no node", async () => {
    // Without the node there is nothing to complete: the line may be parked on any
    // of several waits, and guessing would resume the wrong one.
    const { handler } = harness();

    await expect(handler(params({ nodeId: "" }))).rejects.toThrow(/nodeId/);
  });
});

describe("a resumed node reports its whole result, not only its outcome", () => {
  it("carries the extras a follow-up is routed on", async () => {
    const { handler, finished } = harness();

    await handler(
      params({
        nodeId: "triage",
        outcome: "success",
        result: { outcome: "success", extras: { action: "address" } },
      }),
    );

    expect(finished[0]?.result).toMatchObject({
      outcome: "success",
      extras: { action: "address" },
    });
  });

  it("carries the failure class the dispatch gate trips on", async () => {
    const { handler, finished } = harness();

    await handler(
      params({
        nodeId: "build",
        outcome: "failed",
        result: {
          outcome: "failed",
          failureClass: "anthropic-credit",
          failureDetail: "Credit balance too low",
        },
      }),
    );

    expect(finished[0]?.result).toMatchObject({
      failureClass: "anthropic-credit",
      failureDetail: "Credit balance too low",
    });
  });

  it("falls back to the bare outcome for a human station, which reports no result", async () => {
    const { handler, finished } = harness();

    await handler(params());

    expect(finished[0]?.result).toEqual({ outcome: "changes_requested" });
  });

  it("refuses a result the walk could not route rather than half-applying it", async () => {
    const { handler } = harness();

    await expect(
      handler(
        params({
          outcome: "success",
          result: { outcome: "success", extras: { action: 7 } },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("the guarded outcome and the result's outcome must agree", () => {
  it("rejects a result whose outcome differs from the one the guard checked", async () => {
    const { handler } = harness();

    await expect(
      handler(
        params({
          nodeId: "triage",
          outcome: "success",
          result: { outcome: "failed" },
        }),
      ),
    ).rejects.toThrow(/success.*failed|failed.*success/);
  });

  it("accepts the result when both spell the same outcome", async () => {
    const { handler, finished } = harness();

    await handler(
      params({
        nodeId: "triage",
        outcome: "failed",
        result: { outcome: "failed", failureClass: "unknown" },
      }),
    );

    expect(finished[0]?.outcome).toBe("failed");
  });
});
