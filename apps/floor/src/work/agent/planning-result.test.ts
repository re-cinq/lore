import { describe, it, expect } from "vitest";
import type { AgentFileEvent } from "./agent-events.js";
import {
  deliverPlanningResult,
  planFileOf,
  planRunRefOf,
  receivePlanUpload,
  PLANNING_RESULT_EVENT,
  type PlanRunRef,
  type PlanWriter,
} from "./planning-result.js";

const PLAN_MD =
  "# Faster checkout\n\n## What we want and why <!-- slot:intent -->\n\nCheckout is slow.\n";
const DRAFTING: PlanRunRef = { planId: "p1", refine: null };
const REFINING: PlanRunRef = {
  planId: "p1",
  refine: { slot: "intent", baseHash: "3f9a", uses: { questions: ["q1"] } },
};

function fileEvent(over: Partial<AgentFileEvent> = {}): AgentFileEvent {
  return {
    taskId: "t1",
    agentCrName: "abc-analyze",
    event: PLANNING_RESULT_EVENT,
    path: "plan.md",
    content: PLAN_MD,
    reason: null,
    uploaded: false,
    ...over,
  };
}

function recordingWriter() {
  const writes: Array<{ planId: string; body: unknown }> = [];
  const writer: PlanWriter = {
    markdownOf: async (planId) => `# plan ${planId}\n`,
    submitFile: async (planId, body) => {
      writes.push({ planId, body });
    },
    failRefine: async (planId, refine) => {
      writes.push({ planId, body: { failed: refine } });
    },
  };

  return { writes, writer };
}

const deliver = async (
  event: AgentFileEvent,
  run: PlanRunRef | null = DRAFTING,
) => {
  const { writes, writer } = recordingWriter();
  const delivery = await deliverPlanningResult(event, {
    planRunOfTask: async () => run ?? undefined,
    plans: writer,
  });

  return { delivery, writes };
};

describe("deliverPlanningResult", () => {
  it("writes the edited plan.md into plan p1 as the planning agent's draft", async () => {
    expect(await deliver(fileEvent())).toEqual({
      delivery: { outcome: "ready" },
      writes: [
        {
          planId: "p1",
          body: { actor: "planning-agent", markdown: PLAN_MD, refine: null },
        },
      ],
    });
  });

  it("sends a Refine's plan.md with the intent section's refine context from the run", async () => {
    const { writes } = await deliver(fileEvent(), REFINING);

    expect(writes).toEqual([
      {
        planId: "p1",
        body: {
          actor: "planning-agent",
          markdown: PLAN_MD,
          refine: {
            slot: "intent",
            baseHash: "3f9a",
            uses: { questions: ["q1"] },
          },
        },
      },
    ]);
  });

  it("leaves an uploaded plan.md to its upload, writing nothing from the notice", async () => {
    expect(await deliver(fileEvent({ content: null, uploaded: true }))).toEqual(
      {
        delivery: { outcome: "skipped", error: "delivered by upload" },
        writes: [],
      },
    );
  });

  it("skips an event that is not a planning result", async () => {
    expect(await deliver(fileEvent({ event: "gap.result" }))).toEqual({
      delivery: { outcome: "skipped", error: "not a planning result" },
      writes: [],
    });
  });

  it("skips a run that names no plan", async () => {
    expect(await deliver(fileEvent(), null)).toEqual({
      delivery: { outcome: "skipped", error: "the run names no plan" },
      writes: [],
    });
  });

  it("fails a run that produced no plan.md and writes nothing", async () => {
    expect(
      await deliver(fileEvent({ content: null, reason: "missing" })),
    ).toEqual({
      delivery: {
        outcome: "failed",
        error: "the agent produced no plan.md (missing)",
      },
      writes: [],
    });
  });
});

describe("receivePlanUpload", () => {
  it("writes a 2 MB uploaded plan.md into the plan its agent's run drafts", async () => {
    const { writes, writer } = recordingWriter();
    const markdown = `${PLAN_MD}${"More context. ".repeat(150_000)}`;

    const delivery = await receivePlanUpload(
      { agentCrName: "abc-analyze", markdown, exitCode: 0 },
      {
        planRunOfAgent: async (agent) =>
          agent === "abc-analyze" ? REFINING : undefined,
        plans: writer,
      },
    );

    expect({ delivery, writes }).toEqual({
      delivery: { outcome: "ready" },
      writes: [
        {
          planId: "p1",
          body: { actor: "planning-agent", markdown, refine: REFINING.refine },
        },
      ],
    });
  });

  it("writes nothing for an upload from an agent no planning run knows", async () => {
    const { writes, writer } = recordingWriter();
    const delivery = await receivePlanUpload(
      { agentCrName: "stranger", markdown: PLAN_MD, exitCode: 0 },
      { planRunOfAgent: async () => undefined, plans: writer },
    );

    expect({ delivery, writes }).toEqual({
      delivery: { outcome: "skipped", error: "the run names no plan" },
      writes: [],
    });
  });

  it("still writes a draft whose agent exited 1, since a draft answers no Refine", async () => {
    const { writes, writer } = recordingWriter();
    const delivery = await receivePlanUpload(
      { agentCrName: "abc-analyze", markdown: PLAN_MD, exitCode: 1 },
      { planRunOfAgent: async () => DRAFTING, plans: writer },
    );

    expect({ delivery, writes }).toEqual({
      delivery: { outcome: "ready" },
      writes: [
        {
          planId: "p1",
          body: { actor: "planning-agent", markdown: PLAN_MD, refine: null },
        },
      ],
    });
  });
});

describe("planFileOf", () => {
  it("serves run-1's plan p1 as the markdown the pod downloads", async () => {
    const { writer } = recordingWriter();

    expect(
      await planFileOf("run-1", {
        planOfRun: async (runId) => (runId === "run-1" ? "p1" : undefined),
        plans: writer,
      }),
    ).toBe("# plan p1\n");
  });

  it("serves nothing for a run that names no plan", async () => {
    const { writer } = recordingWriter();

    expect(
      await planFileOf("run-9", {
        planOfRun: async () => undefined,
        plans: writer,
      }),
    ).toBeNull();
  });
});

describe("planRunRefOf", () => {
  it("reads plan p1 and the intent Refine from a planning run's args, and nothing from a run with no plan", () => {
    expect([
      planRunRefOf({
        plan_id: "p1",
        refine: { slot: "intent", baseHash: "3f9a", uses: { questions: [] } },
      }),
      planRunRefOf({ plan_id: "p1", refine: null }),
      planRunRefOf({ description: "no plan here" }),
    ]).toEqual([
      {
        planId: "p1",
        refine: { slot: "intent", baseHash: "3f9a", uses: { questions: [] } },
      },
      { planId: "p1", refine: null },
      undefined,
    ]);
  });
});
