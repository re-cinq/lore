import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { AssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs.js";
import { InMemoryEventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-memory.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { registerBearerScope } from "../../http/bearer-scope.js";
import type { SpecReviewReads } from "../../../work/plans/spec-rework.js";
import {
  planLifecycleRoutes,
  type PlanLifecyclePorts,
} from "./plan-lifecycle.js";
import type { SpecReworkRouteDeps } from "./plan-line-deps.js";

const originalEnv = { ...process.env };
const REPO = "re-cinq/lore";
const PLAN_ID = "0f3c2a2e-6b1a-4c5e-9d2f-1a2b3c4d5e6f";

const GRAPH: RunGraph = {
  name: "feature-planning",
  entry: "write",
  exit: "done",
  nodes: [
    { id: "write", type: "agent", station: "s", station_inherited: false },
    { id: "merged", type: "pr_review", station: "s", station_inherited: false },
    {
      id: "done",
      type: "retrospective",
      station: "s",
      station_inherited: false,
    },
  ],
  edges: [],
};

const REVIEWED: SpecReviewReads = {
  listReviewThreads: async () => [],
  listComments: async () => [],
  listReviews: async () =>
    [
      { id: 9, state: "CHANGES_REQUESTED", body: "Split FR3.", user: "ana" },
    ] as never,
};

const SILENT: SpecReviewReads = {
  listReviewThreads: async () => [],
  listComments: async () => [],
  listReviews: async () => [],
};

async function lineParkedOnMerged(runs: InMemoryAssemblyRuns, args: object) {
  const id = await runs.start({
    blueprintName: "feature-planning",
    repo: REPO,
    branch: "lore/feature-planning/faster-checkout-abcd1234",
    subjectKey: `plan:${PLAN_ID}`,
    args: args as Record<string, unknown>,
  });

  await runs.markRunning(id);
  await runs.stampBlueprint(id, "hash", GRAPH);
  await runs.ensureStationRun({
    assemblyRunId: id,
    nodeId: "merged",
    iteration: 1,
  });

  return id;
}

function subject(pulls: SpecReviewReads, planStatus = "approved") {
  const runs = new InMemoryAssemblyRuns();
  const reporter = new InMemoryEventReporter();
  const deps: SpecReworkRouteDeps = {
    line: new AssemblyRuns(REPO, runs),
    runs,
    pulls,
    station: {
      runs,
      reporter,
      graphOf: async () => GRAPH,
      humanStationIds: () => new Set(["merged"]),
    },
  };
  const pool = planPool(planStatus);
  const server = Hapi.server();

  registerBearerScope(server, () => pool);
  server.route(
    planLifecycleRoutes({
      service: {} as PlanLifecyclePorts["service"],
      getPool: () => pool,
      specReworkDeps: async () => deps,
    }),
  );

  return { server, runs, reporter };
}

function planPool(status: string): Pool {
  return {
    query: async () => ({
      rows: [
        {
          id: PLAN_ID,
          repo: REPO,
          title: "Faster checkout",
          type: "feature",
          template_version: 1,
          status,
          approval: null,
          current_version: 1,
          created_by: "ana",
          created_at: new Date("2026-09-24T10:00:00Z"),
          updated_at: new Date("2026-09-24T10:00:00Z"),
        },
      ],
    }),
  } as unknown as Pool;
}

const rework = (server: Hapi.Server) =>
  server.inject({
    method: "POST",
    url: `/api/repos/${REPO}/plans/${PLAN_ID}/spec-rework`,
    headers: AUTH,
    payload: { actor: "gedaiu" },
  });

describe("POST /api/repos/{owner}/{repo}/plans/{id}/spec-rework", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("answers 202 with the run the writer runs again in, its args carrying spec PR #7's review", async () => {
    const { server, runs, reporter } = subject(REVIEWED);
    const id = await lineParkedOnMerged(runs, { pr_number: 7 });

    const res = await rework(server);

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload) as unknown,
      review: JSON.parse(
        String((await runs.getById(id))?.args.spec_review),
      ) as unknown,
      asked: reporter.rows.map((row) => row.params),
    }).toEqual({
      status: 202,
      body: { run_id: id },
      review: {
        pr_number: 7,
        reviews: [
          {
            id: 9,
            author: "ana",
            state: "CHANGES_REQUESTED",
            body: "Split FR3.",
          },
        ],
        comments: [],
      },
      asked: [
        { assemblyRunId: id, nodeId: "write", actor: "gedaiu", repo: REPO },
      ],
    });
  });

  it("answers 409 from the work layer when nothing on the spec PR waits for the writer", async () => {
    const { server, runs, reporter } = subject(SILENT);

    await lineParkedOnMerged(runs, { pr_number: 7 });
    const res = await rework(server);

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload) as unknown,
      asked: reporter.rows,
    }).toEqual({
      status: 409,
      body: {
        error:
          "nothing on the spec PR is waiting for the writer: no unresolved comment and no review body",
      },
      asked: [],
    });
  });

  it("answers 409 for a plan with no planning line", async () => {
    const { server } = subject(REVIEWED);

    const res = await rework(server);

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload) as unknown,
    }).toEqual({
      status: 409,
      body: { error: "the spec PR is not waiting for review" },
    });
  });

  it("answers 404 for the plan under another repo", async () => {
    const { server } = subject(REVIEWED);

    const res = await server.inject({
      method: "POST",
      url: `/api/repos/acme/elsewhere/plans/${PLAN_ID}/spec-rework`,
      headers: AUTH,
      payload: { actor: "gedaiu" },
    });

    expect(res.statusCode).toBe(404);
  });
});
