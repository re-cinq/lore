import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const TASK_SCOPED = { authorization: "Bearer task-only" };
const TASK_ID = "0b7e3f7e-1111-4222-8333-444455556666";
const FLOOR_URL = "http://lore-floor.test:8080";
const INTERNAL = "internal-secret";

const originalEnv = { ...process.env };
const fetchMock = vi.fn();

const taskPool = () => {
  const pool = makePool();

  pool.query.mockResolvedValue({ rows: [{ id: TASK_ID }] });

  return pool;
};

const post = (
  payload: string,
  pool: unknown = taskPool(),
  headers: Record<string, string> = AUTH,
  taskId: string = TASK_ID,
) =>
  buildServer(() => pool as any).inject({
    method: "POST",
    url: `/api/task-turns/${taskId}`,
    payload,
    headers,
  });

describe("POST /api/task-turns/{taskId}", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.LORE_AGENT_URL = FLOOR_URL;
    process.env.LORE_AGENT_INTERNAL_TOKEN = INTERNAL;
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("wraps each line in the task attribution envelope and forwards NDJSON to the Floor", async () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: "hi" } }),
      JSON.stringify({ type: "result", is_error: false, result: "done" }),
    ];
    const res = await post(lines.join("\n"));

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ forwarded: 3, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe(`${FLOOR_URL}/api/agent-events`);
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${INTERNAL}`,
    });
    const sent = (init.body as string).split("\n").map((l) => JSON.parse(l));

    expect(sent).toEqual(
      lines.map((l) => ({ source: { task: TASK_ID }, event: JSON.parse(l) })),
    );
  });

  it("skips non-JSON lines, file-kind events, and pre-attributed envelopes", async () => {
    const good = JSON.stringify({ type: "assistant" });
    const payload = [
      "--- VALIDATION FAILED ---",
      JSON.stringify({ kind: "file", path: "x", task: "spoof" }),
      JSON.stringify({ source: { agent: "forged-cr" }, event: { type: "x" } }),
      good,
      "",
    ].join("\n");
    const res = await post(payload);

    expect(res.result).toEqual({ forwarded: 1, skipped: 3 });
    const [, init] = fetchMock.mock.calls[0];

    expect(init.body).toBe(
      JSON.stringify({ source: { task: TASK_ID }, event: JSON.parse(good) }),
    );
  });

  it("returns 200 without calling the Floor when no line survives filtering", async () => {
    const res = await post("not json at all");

    expect(res.result).toEqual({ forwarded: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the task does not exist", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await post(JSON.stringify({ type: "assistant" }), pool);

    expect(res.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when no pool is available", async () => {
    const res = await post(JSON.stringify({ type: "assistant" }), null);

    expect(res.statusCode).toBe(503);
  });

  it("returns 503 when the Floor relay env is not configured", async () => {
    delete process.env.LORE_AGENT_URL;
    const res = await post(JSON.stringify({ type: "assistant" }));

    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the Floor rejects the forward", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const res = await post(JSON.stringify({ type: "assistant" }));

    expect(res.statusCode).toBe(502);
  });

  it("returns 400 when taskId is not a uuid", async () => {
    const res = await post(
      JSON.stringify({ type: "assistant" }),
      taskPool(),
      AUTH,
      "not-a-uuid",
    );

    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when the token has task scope but not write", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ scopes: ["task"] }] });
    const res = await post(
      JSON.stringify({ type: "assistant" }),
      pool,
      TASK_SCOPED,
    );

    expect(res.statusCode).toBe(403);
  });
});
