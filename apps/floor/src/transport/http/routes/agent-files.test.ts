import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type {
  FailedRefine,
  PlanFileBody,
} from "../../../domain/plan-writer.js";
import { buildServer } from "../server.js";

const runs = new InMemoryAssemblyRuns();
const submitted: Array<{ planId: string; body: PlanFileBody }> = [];
const failed: Array<{ planId: string; refine: FailedRefine }> = [];

vi.mock("../../../outbound/queues.js", () => ({
  clusterAgent: () => ({}),
  usage: () => ({ logLlmCall: vi.fn() }),
  agentRunEvents: () => ({ insertBatch: vi.fn() }),
  auditLog: () => ({ write: vi.fn() }),
  pipeline: () => ({ assemblyRuns: runs }),
}));

vi.mock("../../../outbound/lore-api-plans.js", () => ({
  loreApiPlans: () => ({
    markdownOf: async (planId: string) => `# plan ${planId}\n`,
    submitFile: async (planId: string, body: PlanFileBody) => {
      submitted.push({ planId, body });
    },
    failRefine: async (planId: string, refine: FailedRefine) => {
      failed.push({ planId, refine });
    },
  }),
}));

const ORIG = process.env.LORE_AGENT_INTERNAL_TOKEN;
const auth = { authorization: "Bearer test-internal" };
const server = () => buildServer({ getJobStatus: () => ({}) });

async function planningRun(args: Record<string, unknown>): Promise<string> {
  const id = await runs.start({
    blueprintName: "feature-planning",
    repo: "re-cinq/lore",
    args,
  });

  await runs.ensureStationRun({
    assemblyRunId: id,
    nodeId: "analyze",
    iteration: 1,
    agentCrName: `${id.substring(0, 12)}-analyze`,
  });

  return id;
}

beforeEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = "test-internal";
  submitted.length = 0;
  failed.length = 0;
});

afterEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG;
});

describe("GET /api/agent-files/runs/{runId}/plan", () => {
  it("serves the run's plan p1 as the plan.md its pod downloads", async () => {
    const runId = await planningRun({ plan_id: "p1" });

    const res = await server().inject({
      method: "GET",
      url: `/api/agent-files/runs/${runId}/plan`,
      headers: auth,
    });

    expect({
      status: res.statusCode,
      type: res.headers["content-type"],
      body: res.payload,
    }).toEqual({
      status: 200,
      type: "text/markdown; charset=utf-8",
      body: "# plan p1\n",
    });
  });

  it("answers 404 for a run that drafts no plan, and 401 without the pod credential", async () => {
    const runId = await planningRun({ description: "no plan" });
    const url = `/api/agent-files/runs/${runId}/plan`;

    expect([
      (await server().inject({ method: "GET", url, headers: auth })).statusCode,
      (await server().inject({ method: "GET", url })).statusCode,
    ]).toEqual([404, 401]);
  });
});

describe("POST /api/agent-files/{agent}/planning.result", () => {
  it("writes a 3 MB uploaded plan.md into the plan the agent's run drafts, with the run's Refine", async () => {
    const runId = await planningRun({
      plan_id: "p1",
      refine: { slot: "intent", baseHash: "3f9a", uses: { questions: [] } },
    });
    const markdown = `# Faster checkout\n${"More context. ".repeat(230_000)}`;

    const res = await server().inject({
      method: "POST",
      url: `/api/agent-files/${runId.substring(0, 12)}-analyze/planning.result`,
      headers: { ...auth, "content-type": "application/octet-stream" },
      payload: Buffer.from(markdown),
    });

    expect({ status: res.statusCode, submitted }).toEqual({
      status: 200,
      submitted: [
        {
          planId: "p1",
          body: {
            actor: "planning-agent",
            markdown,
            refine: {
              slot: "intent",
              baseHash: "3f9a",
              uses: { questions: [] },
            },
          },
        },
      ],
    });
  });

  it("marks the run's Refine of intent failed, writing nothing, when the agent exited 42", async () => {
    const runId = await planningRun({
      plan_id: "p1",
      refine: { slot: "intent", baseHash: "3f9a" },
    });

    const res = await server().inject({
      method: "POST",
      url: `/api/agent-files/${runId.substring(0, 12)}-analyze/planning.result`,
      headers: {
        ...auth,
        "content-type": "application/octet-stream",
        "x-agent-exit-code": "42",
      },
      payload: Buffer.from("# plan as it was downloaded\n"),
    });

    expect({ status: res.statusCode, submitted, failed }).toEqual({
      status: 200,
      submitted: [],
      failed: [
        {
          planId: "p1",
          refine: {
            slot: "intent",
            reason: "the planning agent stopped with exit code 42 before it answered",
          },
        },
      ],
    });
  });

  it("writes nothing for an upload from an agent no planning run knows", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/agent-files/unknown-analyze/planning.result",
      headers: { ...auth, "content-type": "application/octet-stream" },
      payload: Buffer.from("# plan\n"),
    });

    expect({ status: res.statusCode, submitted }).toEqual({
      status: 404,
      submitted: [],
    });
  });
});
