import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const BASE = "/api/skill-definitions";
const originalEnv = { ...process.env };

const HELP = [
  "Body",
  "<!-- lore-help:begin -->",
  "**Summary.** Runs TDD.",
  "**Usage:** /tdd-loop",
  "<!-- lore-help:end -->",
].join("\n");

const storedRow = {
  name: "tdd-loop",
  title: "TDD loop",
  description: "",
  model: null,
  content: HELP,
  enabled: true,
  project_id: null,
};

const storedSkill = {
  name: "tdd-loop",
  title: "TDD loop",
  description: "",
  model: null,
  content: HELP,
  enabled: true,
  projectId: null,
};

function send(
  pool: ReturnType<typeof makePool>,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return buildServer(() => pool as never).inject({
    method,
    url,
    headers: AUTH,
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

function poolAnswering(rows: unknown[], rowCount = rows.length) {
  const pool = makePool();

  pool.query.mockResolvedValue({ rows, rowCount });

  return pool;
}

describe("skill-definitions routes", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("GET lists the org-level tdd-loop skill", async () => {
    const res = await send(poolAnswering([storedRow]), "GET", BASE);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ skills: [storedSkill] });
  });

  it("POST creates tdd-loop and returns the stored row", async () => {
    const pool = poolAnswering([storedRow]);
    const res = await send(pool, "POST", BASE, {
      name: "tdd-loop",
      title: "TDD loop",
      content: HELP,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true, skill: storedSkill });
    expect(pool.query.mock.calls[0]?.[1]).toEqual([
      "tdd-loop",
      "TDD loop",
      "",
      null,
      HELP,
      undefined,
    ]);
  });

  it("POST answers 409 when tdd-loop already exists", async () => {
    const res = await send(poolAnswering([]), "POST", BASE, {
      name: "tdd-loop",
      title: "TDD loop",
      content: HELP,
    });

    expect(res.statusCode).toBe(409);
  });

  it("POST answers 400 when the content has no lore-help block", async () => {
    const pool = poolAnswering([storedRow]);
    const res = await send(pool, "POST", BASE, {
      name: "tdd-loop",
      title: "TDD loop",
      content: "no help here",
    });

    expect(res.statusCode).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("PUT answers 404 when no skill named ghost exists", async () => {
    const res = await send(poolAnswering([]), "PUT", `${BASE}/ghost`, {
      title: "Ghost",
      content: HELP,
    });

    expect(res.statusCode).toBe(404);
  });

  it("DELETE removes tdd-loop", async () => {
    const res = await send(
      poolAnswering([{ name: "tdd-loop" }]),
      "DELETE",
      `${BASE}/tdd-loop`,
    );

    expect(JSON.parse(res.payload)).toEqual({ ok: true, deleted: "tdd-loop" });
  });

  it("DELETE answers 404 when no skill named ghost exists", async () => {
    const res = await send(poolAnswering([]), "DELETE", `${BASE}/ghost`);

    expect(res.statusCode).toBe(404);
  });
});
