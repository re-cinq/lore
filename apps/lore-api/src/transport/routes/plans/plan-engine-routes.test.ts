import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  planRun,
  planVisit,
  recordedPlanFloor,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { registerBearerScope } from "../../http/bearer-scope.js";
import type { PlanVerbSeams } from "./plan-verbs-for.js";
import {
  planLifecycleRoutes,
  type PlanLifecyclePorts,
} from "./plan-lifecycle.js";
import { plansRoutes } from "./plans.js";
import { specBranchOf } from "../../../work/plans/spec-branch.js";

const originalEnv = { ...process.env };
const REPO = "re-cinq/lore";
const PLAN_ID = "0f3c2a2e-6b1a-4c5e-9d2f-1a2b3c4d5e6f";
const SUCCESS = { outcome: "success" };

const PLAN_ROW = {
  id: PLAN_ID,
  repo: REPO,
  title: "Faster checkout",
  type: "feature",
  template_version: 1,
  status: "draft",
  approval: null,
  current_version: 1,
  created_by: "ana",
  created_at: new Date("2026-09-24T10:00:00Z"),
  updated_at: new Date("2026-09-24T10:00:00Z"),
};

const ON_AUTHOR = [
  planVisit("analyze", SUCCESS),
  planVisit("plan-pass-end", SUCCESS),
  planVisit("author", null),
];
const WHILE_ANALYZING = [
  planVisit("author", SUCCESS),
  planVisit("analyze", null),
];

const REFINE = {
  slot: "intent",
  title: "Intent",
  baseHash: "3f9a",
  inputs: {},
  uses: {},
};

function subject(
  given: { runs?: boolean; visits?: object[]; status?: string } = {},
) {
  const recorded = recordedPlanFloor({
    runs: given.runs === false ? [] : [planRun()],
    visits: { "run-open": (given.visits ?? []) as never },
  });
  const reopened: string[] = [];
  const pool = {
    query: async (text: string) => ({
      rows: text.includes("assembly_runs")
        ? []
        : [{ ...PLAN_ROW, status: given.status ?? "draft" }],
    }),
  } as unknown as Pool;
  const seams: PlanVerbSeams = {
    livePlan: async () => ({
      meta: { ...PLAN_ROW, status: "draft" } as never,
      blocks: [],
    }),
    floorDeps: {
      floor: recorded.floor,
      specBranch: async (plan) => specBranchOf(plan),
      baseBranch: () => Promise.resolve("main"),
      specPrState: () => Promise.resolve(null),
      pulls: {
        listReviewThreads: async () => [],
        listComments: async () => [],
        listReviews: async () => [],
      },
    },
  };
  const server = Hapi.server();

  registerBearerScope(server, () => pool);
  server.route([
    ...plansRoutes(() => pool, seams),
    ...planLifecycleRoutes({
      service: {
        reopenPlan: async (planId: string) => (reopened.push(planId), PLAN_ROW),
      } as unknown as PlanLifecyclePorts["service"],
      getPool: () => pool,
      ...seams,
    }),
  ]);

  return { server, requests: recorded.requests, reopened };
}

const post = (server: Hapi.Server, path: string, payload: object) =>
  server.inject({
    method: "POST",
    url: `/api/repos/${REPO}/plans/${PLAN_ID}/${path}`,
    headers: AUTH,
    payload,
  });

const answer = (res: Hapi.ServerInjectResponse) => ({
  status: res.statusCode,
  body: JSON.parse(res.payload) as unknown,
});

const writes = (requests: { method: string; path: string }[]) =>
  requests
    .filter((request) => request.method === "POST")
    .map((request) => request.path);

describe("the plan routes on a plan the floor holds", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("answers drafting with 202 and the run it started when neither store holds a run for the plan", async () => {
    const { server, requests } = subject({ runs: false });

    const res = await post(server, "drafting", {
      known: "Slow.",
      createdBy: "ana",
    });

    expect(answer(res)).toEqual({ status: 202, body: { task_id: "run-new" } });
    expect(writes(requests)).toEqual([
      "/blobs",
      "/assembly-lines/feature-planning/start",
    ]);
  });

  it("answers refine with 202 and reports the section on the author visit", async () => {
    const { server, requests } = subject({ visits: ON_AUTHOR });

    const res = await post(server, "refine", REFINE);

    expect(answer(res)).toEqual({ status: 202, body: { slot: "intent" } });
    expect(writes(requests)).toEqual(["/blobs", "/events"]);
  });

  it("answers refine with 409 while the planning agent is still working on the plan", async () => {
    const { server, requests } = subject({ visits: WHILE_ANALYZING });

    const res = await post(server, "refine", REFINE);

    expect(answer(res)).toEqual({
      status: 409,
      body: { error: "the planning agent is still working on this plan" },
    });
    expect(writes(requests)).toEqual([]);
  });

  it("answers approve with 409 while the agent is refining a section, before the plan's status could flip", async () => {
    const { server } = subject({ visits: WHILE_ANALYZING });

    const res = await post(server, "approve", { approvedBy: "ana" });

    expect(answer(res)).toEqual({
      status: 409,
      body: { error: "the planning agent is still refining a section" },
    });
  });

  it("answers validate with 202 and the run the floor is asked to validate in", async () => {
    const { server, requests } = subject({ visits: ON_AUTHOR });

    const res = await post(server, "validate", { actor: "gedaiu" });

    expect(answer(res)).toEqual({ status: 202, body: { run_id: "run-open" } });
    expect(writes(requests)).toEqual(["/events"]);
  });

  it("answers spec-rework with 409 for a plan with no planning run", async () => {
    const { server, requests } = subject({ runs: false, status: "approved" });

    const res = await post(server, "spec-rework", { actor: "gedaiu" });

    expect(answer(res)).toEqual({
      status: 409,
      body: { error: "the spec PR is not waiting for review" },
    });
    expect(writes(requests)).toEqual([]);
  });

  it("answers validate with 404 for the plan asked for under another repo", async () => {
    const { server } = subject({ visits: ON_AUTHOR });

    const res = await server.inject({
      method: "POST",
      url: `/api/repos/re-cinq/other/plans/${PLAN_ID}/validate`,
      headers: AUTH,
      payload: { actor: "gedaiu" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("reopens an approved plan whose floor run waits on its author when author-waiting is asked", async () => {
    const { server, reopened } = subject({
      visits: ON_AUTHOR,
      status: "approved",
    });

    const res = await post(server, "author-waiting", {});

    expect(answer(res)).toEqual({ status: 200, body: { reopened: true } });
    expect(reopened).toEqual([PLAN_ID]);
  });
});
