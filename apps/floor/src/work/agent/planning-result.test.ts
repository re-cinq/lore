import { describe, it, expect } from "vitest";
import type { AgentFileEvent } from "./agent-events.js";
import {
  deliverPlanningResult,
  PLANNING_RESULT_EVENT,
  type PlanWriter,
} from "./planning-result.js";

const OPS = [
  {
    op: "set-section-text",
    slot: "intent",
    paragraphs: ["Checkout is slow."],
  },
];

function fileEvent(
  content: unknown,
  over: Partial<AgentFileEvent> = {},
): AgentFileEvent {
  return {
    taskId: "t1",
    agentCrName: "abc-analyze",
    event: PLANNING_RESULT_EVENT,
    path: "/workspace/target/result.json",
    content: typeof content === "string" ? content : JSON.stringify(content),
    reason: null,
    ...over,
  };
}

function recordingWriter() {
  const writes: Array<{ call: string; planId: string; body: unknown }> = [];
  const writer: PlanWriter = {
    applyOps: async (planId, body) => {
      writes.push({ call: "agent-edits", planId, body });
    },
    propose: async (planId, body) => {
      writes.push({ call: "proposals", planId, body });
    },
  };

  return { writes, writer };
}

const deliver = async (event: AgentFileEvent, planId: string | null = "p1") => {
  const { writes, writer } = recordingWriter();
  const delivery = await deliverPlanningResult(event, {
    planOf: async () => planId ?? undefined,
    plans: writer,
  });

  return { delivery, writes };
};

describe("deliverPlanningResult", () => {
  it("writes a draft's ops into plan p1 as the planning agent", async () => {
    expect(await deliver(fileEvent({ ops: OPS }))).toEqual({
      delivery: { outcome: "ready" },
      writes: [
        {
          call: "agent-edits",
          planId: "p1",
          body: { actor: "planning-agent", ops: OPS },
        },
      ],
    });
  });

  it("proposes a Refine's ops for the intent section of plan p1", async () => {
    const proposal = {
      slot: "intent",
      baseHash: "3f9a",
      ops: OPS,
      uses: { questions: ["q1"], comments: [] },
    };

    expect(await deliver(fileEvent(proposal))).toEqual({
      delivery: { outcome: "ready" },
      writes: [
        {
          call: "proposals",
          planId: "p1",
          body: { actor: "planning-agent", ...proposal },
        },
      ],
    });
  });

  it("skips an event that is not a planning result", async () => {
    expect(
      await deliver(fileEvent({ ops: OPS }, { event: "spec.plan" })),
    ).toEqual({
      delivery: { outcome: "skipped", error: "not a planning result" },
      writes: [],
    });
  });

  it("skips a run that names no plan", async () => {
    expect(await deliver(fileEvent({ ops: OPS }), null)).toEqual({
      delivery: { outcome: "skipped", error: "the run names no plan" },
      writes: [],
    });
  });

  it("fails a result.json that is not JSON and writes nothing", async () => {
    expect(await deliver(fileEvent("{not json"))).toMatchObject({
      delivery: {
        outcome: "failed",
        error: expect.stringContaining("result.json is not valid JSON"),
      },
      writes: [],
    });
  });

  it("fails a result that is neither agent ops nor a section proposal", async () => {
    expect(await deliver(fileEvent({ sections: [] }))).toEqual({
      delivery: {
        outcome: "failed",
        error: "result.json holds neither ops nor a section proposal",
      },
      writes: [],
    });
  });

  it("fails a run that produced no result.json", async () => {
    expect(await deliver(fileEvent("", { reason: "missing" }))).toEqual({
      delivery: {
        outcome: "failed",
        error: "the agent produced no result.json (missing)",
      },
      writes: [],
    });
  });
});
