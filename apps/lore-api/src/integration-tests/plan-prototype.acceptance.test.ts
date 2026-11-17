import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../app/build-server.js";
import { restoreEnv } from "./restore-env.js";
import { recordedPlanFloor } from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import { specBranchOf } from "@re-cinq/lore-shared/feature-planning/spec-branch.js";

const TOKEN = "test-plan-prototype-token";
const READ_TOKEN = "test-plan-prototype-read-token";
const REPO = "acme/plan-prototype";

describe("Plan prototype validation (spec 205)", () => {
  restoreEnv();

  let pool: pg.Pool;
  let server: Server;
  const recorded = recordedPlanFloor();

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

  afterAll(async () => {
    await pool.end();
  });

  const call = async (
    method: string,
    url: string,
    token?: string,
    body?: unknown,
  ) => {
    const response = await server.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      payload: body,
    });

    return { status: response.statusCode, body: response.result };
  };

  const createPlan = async (type: string) =>
    (
      (
        await call("POST", "/api/plans", TOKEN, {
          repo: REPO,
          title: "Test Plan",
          type,
          createdBy: "ana",
        })
      ).body as {
        meta: { id: string };
      }
    ).meta.id;

  it("an empty prototype section reads 'needs a prototype or a sketch' and blocks approval", async () => {
    const planId = await createPlan("feature");
    const refused = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/approve`,
      TOKEN,
      { approvedBy: "ana" },
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      problems: expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringContaining("needs a prototype or a sketch"),
        }),
      ]),
    });
  });

  it("a ui-change plan still needs a prototype of at least click-dummy maturity at approval, which a sketch does not satisfy", async () => {
    const planId = await createPlan("ui-change");

    await call("POST", `/api/plans/${planId}/agent-edits`, TOKEN, {
      actor: "planning-agent",
      ops: [
        {
          op: "add-mockup",
          slot: "prototype",
          mockup: {
            mockupId: "m-ui-1",
            kind: "ui",
            format: "html",
            caption: "Screen",
            markup: "<div></div>",
            height: 100,
          },
        },
      ],
    });

    const refused = await call(
      "POST",
      `/api/repos/${REPO}/plans/${planId}/approve`,
      TOKEN,
      { approvedBy: "ana" },
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      problems: expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringContaining("click-dummy"),
        }),
      ]),
    });
  });
});
