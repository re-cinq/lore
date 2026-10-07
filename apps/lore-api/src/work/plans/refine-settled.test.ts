import { describe, expect, it } from "vitest";
import { settleRefine, type RefineSettlePorts } from "./refine-settled.js";
import type { RefineAsk } from "./refine-asks.js";

const ASK: RefineAsk = {
  planId: "p1",
  slot: "intent",
  title: "Intent",
  baseHash: "3f9a",
  inputs: {},
  uses: { answers: ["a1"] },
  brief: 'Refine the section "Intent" (<!-- slot:intent -->)',
};

function scene(pending: RefineAsk | null) {
  const calls: string[] = [];
  const cleared: string[] = [];
  const ports: RefineSettlePorts = {
    refineAsks: {
      pending: () => Promise.resolve(pending),
      clear: async (planId) => {
        cleared.push(planId);
      },
    },
    writer: {
      finishRefine: async (request) => {
        calls.push(`finish ${request.slot} ${JSON.stringify(request.uses)}`);
      },
      failRefine: async (request) => {
        calls.push(`fail ${request.slot} ${request.reason}`);
      },
    },
  };

  return { ports, calls, cleared };
}

describe("settleRefine", () => {
  it("finishes the pending ask with the uses it was made for when the pass succeeded", async () => {
    const { ports, calls, cleared } = scene(ASK);

    const settled = await settleRefine("p1", { outcome: "success" }, ports);

    expect({ settled, calls, cleared }).toEqual({
      settled: { settled: true, slot: "intent" },
      calls: ['finish intent {"answers":["a1"]}'],
      cleared: ["p1"],
    });
  });

  it("fails the pending ask with the reason the pass stopped for, so the section says why", async () => {
    const { ports, calls, cleared } = scene(ASK);

    await settleRefine(
      "p1",
      { outcome: "failed", reason: "the pod died" },
      ports,
    );

    expect({ calls, cleared }).toEqual({
      calls: ["fail intent the pod died"],
      cleared: ["p1"],
    });
  });

  it("settles nothing for a pass nobody asked for, which is a first draft", async () => {
    const { ports, calls, cleared } = scene(null);

    const settled = await settleRefine("p1", { outcome: "success" }, ports);

    expect({ settled, calls, cleared }).toEqual({
      settled: { settled: false },
      calls: [],
      cleared: [],
    });
  });

  it("clears the ask even when the pass stopped, so a second Refine is not answered by the first's failure", async () => {
    const { ports, cleared } = scene(ASK);

    await settleRefine("p1", { outcome: "changes_requested" }, ports);

    expect(cleared).toEqual(["p1"]);
  });
});
