import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../app/build-server.js";
import { restoreEnv } from "./restore-env.js";
import { collabAuthenticator } from "../work/plans/collab-tokens.js";

const TOKEN = "test-plan-routes-token";
const READ_TOKEN = "test-plan-routes-read-token";
const REPO = "acme/plan-routes";
const NEW_PLAN = { repo: REPO, title: "Faster checkout", type: "feature", createdBy: "ana" };

describe("/api/plans on lore-api", () => {
  let pool: pg.Pool;
  let server: Server;
  const prevToken = process.env.LORE_INGEST_TOKEN;

  const createPlan = async () =>
    ((await call("POST", "/api/plans", TOKEN, NEW_PLAN)).body as { meta: { id: string } }).meta.id;

  const call = async (method: string, url: string, token?: string, payload?: object) => {
    const res = await server.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: payload ? JSON.stringify(payload) : undefined,
    });

    return { status: res.statusCode, body: JSON.parse(res.payload) as unknown };
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
    server = buildServer(() => pool);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM lore.plans WHERE repo = $1", [REPO]);
    await pool.query("DELETE FROM pipeline.api_tokens WHERE name = 'plan-routes-read'");
    await pool.end();
    restoreEnv("LORE_INGEST_TOKEN", prevToken);
  });

  it("answers 401 to a plan read without a bearer token", async () => {
    expect((await call("GET", "/api/plans/00000000-0000-0000-0000-000000000000")).status).toBe(401);
  });

  it("answers 403 to a plan created with a read-only token", async () => {
    expect((await call("POST", "/api/plans", READ_TOKEN, NEW_PLAN)).status).toBe(403);
  });

  it("creates a plan with a write token and reads back its feature sections", async () => {
    const created = await call("POST", "/api/plans", TOKEN, NEW_PLAN);
    const planId = (created.body as { meta: { id: string } }).meta.id;
    const read = await call("GET", `/api/plans/${planId}`, READ_TOKEN);

    expect(read).toMatchObject({
      status: 200,
      body: { json: { title: "Faster checkout", sections: expect.arrayContaining([expect.objectContaining({ slot: "intent" })]) } },
    });
  });

  it("lists the plan Ana created as a draft feature of the repo", async () => {
    const planId = await createPlan();
    const listed = await call("GET", `/api/repos/${REPO}/plans`, READ_TOKEN);

    expect(listed).toMatchObject({
      status: 200,
      body: { plans: expect.arrayContaining([expect.objectContaining({ id: planId, type: "feature", status: "draft" })]) },
    });
  });

  it("mints a collab token that opens the plan as Ana", async () => {
    const planId = await createPlan();
    const minted = await call("POST", `/api/repos/${REPO}/plans/${planId}/collab-token`, TOKEN, {
      user: { id: "ana", name: "Ana" },
      role: "write",
    });
    const { token } = minted.body as { token: string };

    expect(await collabAuthenticator(() => pool).authenticate(token, { repo: REPO, planId })).toEqual({
      id: "ana",
      name: "Ana",
      role: "write",
    });
  });

  it("answers 404 to a collab token for the plan under another repo", async () => {
    const planId = await createPlan();
    const minted = await call("POST", `/api/repos/acme/other/plans/${planId}/collab-token`, TOKEN, {
      user: { id: "ana", name: "Ana" },
      role: "write",
    });

    expect(minted.status).toBe(404);
  });
});
