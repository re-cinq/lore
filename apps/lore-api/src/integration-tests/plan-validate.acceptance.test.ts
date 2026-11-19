import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../app/build-server.js";
import {
  planRun,
  planVisit,
  recordedPlanFloor,
  type PlanFloorScene,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import { specBranchOf } from "@re-cinq/lore-shared/feature-planning/spec-branch.js";

const TOKEN = "test-plan-routes-token";
const READ_TOKEN = "test-plan-routes-read-token";
const REPO = "acme/plan-routes";
const NEW_PLAN = {
  repo: REPO,
  title: "Faster checkout",
  type: "feature",
  createdBy: "ana",
};

const SUCCESS = { outcome: "success" };
const ON_AUTHOR = [
  planVisit("analyze", SUCCESS),
  planVisit("plan-pass-end", SUCCESS),
  planVisit("author", null),
];
const WHILE_ANALYZING = [
  planVisit("author", SUCCESS),
  planVisit("analyze", null),
];

describe("Validate the plan before approval (Part 1)", () => {
  let pool: pg.Pool;
  let server: Server;
  let recorded = recordedPlanFloor();

  const onFloor = (scene: PlanFloorScene) => {
    recorded = recordedPlanFloor(scene);
  };

  const createPlan = async () =>
    (
      (await call("POST", "/api/plans", TOKEN, NEW_PLAN)).body as {
        meta: { id: string };
      }
    ).meta.id;

  const approvedPlan = async () => {
    const planId = await createPlan();

    await pool.query(
      "UPDATE lore.plans SET status = 'approved', approval = $2 WHERE id = $1",
      [
        planId,
        {
          mode: "manual",
          approvedBy: "ana",
          approvedAt: "2026-09-23T10:00:00.000Z",
          version: 1,
        },
      ],
    );

    return planId;
  };

  const call = async (
    method: string,
    url: string,
    token?: string,
    payload?: object,
  ) => {
    const res = await server.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: payload ? JSON.stringify(payload) : undefined,
    });

    return { status: res.statusCode, body: JSON.parse(res.payload || "{}") };
  };

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = TOKEN;
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query(
      `INSERT INTO pipeline.api_tokens (name, token_hash, scopes, created_by)
       VALUES ('plan-routes-read', $1, '{read}', 'test') ON CONFLICT (token_hash) DO NOTHING`,
      [createHash("sha256").update(READ_TOKEN).digest("hex")],
    );
    server = buildServer(() => pool, 0, {
      get floor() {
        return recorded.floor;
      },
      specBranch: async (plan) => specBranchOf(plan),
      baseBranch: () => Promise.resolve("main"),
      specPrState: () => Promise.resolve(null),
      recordRefineAsk: () => Promise.resolve(),
      savedStory: async () => undefined,
      pulls: {
        listReviewThreads: async () => [],
        listComments: async () => [],
        listReviews: async () => [],
      },
    });
  });

  beforeEach(() => onFloor({}));

  afterAll(async () => {
    await pool.query("DELETE FROM lore.plans WHERE repo = $1", [REPO]);
    await pool.query(
      "DELETE FROM pipeline.api_tokens WHERE name = 'plan-routes-read'",
    );
    await pool.end();
  });

  it("answers 202 with the run when running the validate station over a draft plan", async () => {
    const planId = await createPlan();

    onFloor({ runs: [planRun()], visits: { "run-open": ON_AUTHOR } });

    const response = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/validate`,
      TOKEN,
      { actor: "ana" },
    );

    expect(response).toMatchObject({
      status: 202,
      body: { run_id: "run-open" },
    });
  });

  it("answers 409 to validating an approved plan", async () => {
    const planId = await approvedPlan();

    onFloor({ runs: [planRun()], visits: { "run-open": ON_AUTHOR } });

    const response = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/validate`,
      TOKEN,
      { actor: "ana" },
    );

    expect(response.status).toBe(409);
  });

  it("answers 409 to validating a plan with no planning line yet", async () => {
    const planId = await createPlan();

    const response = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/validate`,
      TOKEN,
      { actor: "ana" },
    );

    expect(response.status).toBe(409);
  });

  it("answers 409 to validating a plan whose agent is still working", async () => {
    const planId = await createPlan();

    onFloor({ runs: [planRun()], visits: { "run-open": WHILE_ANALYZING } });

    const response = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/validate`,
      TOKEN,
      { actor: "ana" },
    );

    expect(response.status).toBe(409);
  });
});
