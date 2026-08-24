import { describe, it, expect } from "vitest";
import { startRefinementRound } from "./refinement-round.js";
import type { RefinementRoundDeps } from "./refinement-round.js";

const FEATURE = {
  id: "f-1",
  title: "A feature",
  original_prompt: "make it good",
  iterations: [] as unknown[],
};

function deps(over: Partial<RefinementRoundDeps> = {}): RefinementRoundDeps {
  const order: string[] = [];

  return {
    order,
    parkedNode: async () => ({
      runId: "r-1",
      parked: { lineId: "r-1", nodeId: "author", iteration: 1 },
    }),
    appendIteration: async () => {
      order.push("append");

      return { iteration: 2 };
    },
    report: async () => {
      order.push("report");
    },
    ...over,
  } as RefinementRoundDeps & { order: string[] };
}

describe("startRefinementRound", () => {
  it("reports the author's feedback to the node the line is parked on", async () => {
    const reported: Array<{ nodeId: string; outcome: string }> = [];

    const result = await startRefinementRound(
      FEATURE,
      { answers: {}, rewoundTo: undefined },
      deps({
        report: async (target, outcome) => {
          reported.push({ nodeId: target.nodeId, outcome });
        },
      }),
    );

    expect(reported).toEqual([
      { nodeId: "author", outcome: "changes_requested" },
    ]);
    expect(result.iteration).toBe(2);
  });

  it("refuses BEFORE appending a round, so a refusal cannot leave one nothing will run", async () => {
    const d = deps({
      parkedNode: async () => ({ runId: "r-1", parked: null }),
    }) as RefinementRoundDeps & { order: string[] };

    await expect(
      startRefinementRound(FEATURE, { answers: {} }, d),
    ).rejects.toThrow(/not parked/);
    expect(d.order).toEqual([]);
  });

  it("appends the round before reporting it, so the report names a round that exists", async () => {
    const d = deps() as RefinementRoundDeps & { order: string[] };

    await startRefinementRound(FEATURE, { answers: {} }, d);

    expect(d.order).toEqual(["append", "report"]);
  });

  it("sends the rewind target on every round, so an earlier one stops steering", async () => {
    const args: Array<Record<string, unknown>> = [];

    await startRefinementRound(
      FEATURE,
      { answers: {}, rewoundTo: undefined },
      deps({
        report: async (_t, _o, a) => {
          args.push(a);
        },
      }),
    );

    expect(args[0]).toHaveProperty("resume_from_iteration", null);
  });
});
