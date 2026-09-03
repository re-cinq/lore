import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/pipeline/pipeline.js", () => ({
  createTask: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  retryTask: vi.fn(),
}));
vi.mock(
  "@re-cinq/lore-server-core/features/pipeline/pipeline-config.js",
  () => ({
    getTaskTypes: vi.fn(() => ["review", "general", "implementation"]),
  }),
);

import {
  createTask,
  retryTask,
} from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";

const originalEnv = { ...process.env };

describe("POST /api/task", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function post(body: unknown, pool: unknown = makePool()) {
    const payload = typeof body === "string" ? body : JSON.stringify(body);

    return buildServer(() => pool as any).inject({
      method: "POST",
      url: "/api/task",
      headers: AUTH,
      payload,
    });
  }

  it("returns 503 when pool is null", async () => {
    const res = await post({}, null);

    expect(res.statusCode).toBe(503);
  });

  it("retries a task", async () => {
    vi.mocked(retryTask).mockResolvedValue({ task_id: "new" } as any);
    const res = await post({ action: "retry", task_id: "old" });

    expect(res.result).toEqual({ task_id: "new" });
  });

  function poolWithTask(status: string) {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "t1", status }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [{ status }] });

    return pool;
  }

  it("cancels a task", async () => {
    const res = await post(
      { action: "cancel", task_id: "t1" },
      poolWithTask("running"),
    );

    expect(res.result).toEqual({ task_id: "t1", status: "cancelled" });
  });

  it("returns 404 when cancelling a task that does not exist", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await post({ action: "cancel", task_id: "gone" }, pool);

    expect(res.statusCode).toBe(404);
    expect(res.result).toEqual({ error: "Task not found" });
  });

  it("returns 409 when cancelling a merged task", async () => {
    const res = await post(
      { action: "cancel", task_id: "t1" },
      poolWithTask("merged"),
    );

    expect(res.statusCode).toBe(409);
    expect(res.result).toEqual({
      error: "Cannot cancel task in merged state",
    });
  });

  it("escalates a pending task to immediate", async () => {
    const res = await post(
      { action: "run-now", task_id: "t1" },
      poolWithTask("pending"),
    );

    expect(res.result).toEqual({ task_id: "t1", priority: "immediate" });
  });

  it("returns 404 when escalating a task that does not exist", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await post({ action: "run-now", task_id: "gone" }, pool);

    expect(res.statusCode).toBe(404);
    expect(res.result).toEqual({ error: "Task not found" });
  });

  it("returns 409 when escalating a running task", async () => {
    const res = await post(
      { action: "run-now", task_id: "t1" },
      poolWithTask("running"),
    );

    expect(res.statusCode).toBe(409);
    expect(res.result).toEqual({
      error: "Can only escalate pending tasks, current status: running",
    });
  });

  it("queues a revision and answers with the new task id", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: "t1", status: "pr-created", task_type: "implementation" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "rev-1" }] })
      .mockResolvedValue({ rows: [] });
    const res = await post(
      { action: "revise", task_id: "t1", feedback: "tighten it" },
      pool,
    );

    expect(res.result).toEqual({ task_id: "t1", revision_task_id: "rev-1" });
  });

  it("returns 404 when revising a task that does not exist", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await post(
      { action: "revise", task_id: "gone", feedback: "x" },
      pool,
    );

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when revising with blank feedback", async () => {
    const res = await post(
      { action: "revise", task_id: "t1", feedback: "   " },
      poolWithTask("pr-created"),
    );

    expect(res.statusCode).toBe(409);
    expect(res.result).toEqual({ error: "Feedback is required" });
  });

  it("sets immediate priority", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const res = await post(
      { action: "set-priority", task_id: "t1", priority: "immediate" },
      pool,
    );

    expect(res.result).toEqual({
      ok: true,
      task_id: "t1",
      priority: "immediate",
    });
  });

  it("normalizes a non-immediate priority", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const res = await post(
      { action: "set-priority", task_id: "t1", priority: "low" },
      pool,
    );

    expect(res.result).toMatchObject({ priority: "normal" });
  });

  it("updates status with pr_url and error", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const res = await post(
      { task_id: "t1", status: "pr-created", pr_url: "u", error: "e" },
      pool,
    );

    expect(res.result).toEqual({
      ok: true,
      task_id: "t1",
      status: "pr-created",
    });
  });

  it("updates status without optional fields", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const res = await post({ task_id: "t1", status: "completed" }, pool);

    expect(res.result).toMatchObject({ status: "completed" });
  });

  it("rejects an invalid status", async () => {
    const res = await post({ task_id: "t1", status: "bogus" });

    expect(res.statusCode).toBe(400);
  });

  it("creates a task with a known type", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c1" } as any);
    await post({ description: "do it", task_type: "review" });
    expect(createTask).toHaveBeenCalledWith(
      "do it",
      "review",
      undefined,
      "remote-mcp",
      undefined,
      "normal",
      undefined,
    );
  });

  it("attributes the task to the caller-supplied created_by", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "t1" } as never);
    await post({ description: "d", created_by: "bogdan@re-cinq.com" });

    expect(createTask).toHaveBeenCalledWith(
      "d",
      "general",
      undefined,
      "bogdan@re-cinq.com",
      undefined,
      "normal",
      undefined,
    );
  });

  it("attributes to remote-mcp when the caller names nobody", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "t1" } as never);
    await post({ description: "d" });

    expect(createTask).toHaveBeenCalledWith(
      "d",
      "general",
      undefined,
      "remote-mcp",
      undefined,
      "normal",
      undefined,
    );
  });

  it("falls back to general for an unknown type", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c2" } as any);
    await post({
      description: "do it",
      task_type: "zzz",
      context: { a: 1 },
      priority: "immediate",
    });
    expect(createTask).toHaveBeenCalledWith(
      "do it",
      "general",
      undefined,
      "remote-mcp",
      { a: 1 },
      "immediate",
      undefined,
    );
  });

  it("defaults to general when no task_type is provided", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c3" } as any);
    await post({ description: "do it" });
    expect(createTask).toHaveBeenCalledWith(
      "do it",
      "general",
      undefined,
      "remote-mcp",
      undefined,
      "normal",
      undefined,
    );
  });

  it("threads group_id through to createTask when provided", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c4" } as any);
    await post({ description: "do it", group_id: "g-1" });
    expect(createTask).toHaveBeenCalledWith(
      "do it",
      "general",
      undefined,
      "remote-mcp",
      undefined,
      "normal",
      "g-1",
    );
  });

  it("returns 400 when description is blank", async () => {
    const res = await post({ description: "   " });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on invalid JSON, not 500", async () => {
    const res = await post("{bad");

    expect(res.statusCode).toBe(400);
  });

  it("refuses task_type onboard and points at the guarded onboard route", async () => {
    const res = await post({ description: "onboard us", task_type: "onboard" });

    expect(res.statusCode).toBe(400);
    expect(res.result).toMatchObject({
      error: expect.stringContaining("/api/onboard"),
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("cancel records a task_events row for the status transition", async () => {
    const pool = poolWithTask("running");

    await post({ action: "cancel", task_id: "t1" }, pool);
    const eventInsert = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO pipeline.task_events"),
    );

    expect(eventInsert?.[1]).toMatchObject([
      "t1",
      "running",
      "cancelled",
      JSON.stringify({ cancelled_by: "user" }),
    ]);
  });

  it("set-priority updates only pending tasks with the resolved priority", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    await post(
      { action: "set-priority", task_id: "t1", priority: "immediate" },
      pool,
    );
    const [sql, params] = pool.query.mock.calls[0];

    expect(sql).toContain("status = 'pending'");
    expect(params).toEqual(["immediate", "t1"]);
  });

  it("set-priority without a priority falls through to create and 400s", async () => {
    const res = await post({ action: "set-priority", task_id: "t1" });

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "description is required" });
  });
});
