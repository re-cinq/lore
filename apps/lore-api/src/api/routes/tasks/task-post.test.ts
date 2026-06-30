import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/pipeline/pipeline.js", () => ({ createTask: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(), retryTask: vi.fn() }));
vi.mock("@re-cinq/lore-server-core/features/pipeline/pipeline-config.js", () => ({ getTaskTypes: vi.fn(() => ["review", "general", "implementation"]) }));

import { createTask, retryTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";

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

  function post(body: unknown, pool: any = makePool()) {
    const res = makeRes();
    return handleApiRoute(makeReq({ url: "/api/task", method: "POST", headers: AUTH, body }), res, pool).then(() => res);
  }

  it("returns 503 when pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/task", method: "POST", headers: AUTH, body: {} }), res, null);
    expect(res.statusCode).toBe(503);
  });
  it("retries a task", async () => {
    vi.mocked(retryTask).mockResolvedValue({ task_id: "new" } as any);
    const res = await post({ action: "retry", task_id: "old" });
    expect(res.json).toEqual({ task_id: "new" });
  });
  it("cancels a task", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await post({ action: "cancel", task_id: "t1" }, pool);
    expect(res.json).toEqual({ ok: true, task_id: "t1" });
  });
  it("sets immediate priority", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await post({ action: "set-priority", task_id: "t1", priority: "immediate" }, pool);
    expect(res.json).toEqual({ ok: true, task_id: "t1", priority: "immediate" });
  });
  it("normalizes a non-immediate priority", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await post({ action: "set-priority", task_id: "t1", priority: "low" }, pool);
    expect(res.json.priority).toBe("normal");
  });
  it("updates status with pr_url and error", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await post({ task_id: "t1", status: "pr-created", pr_url: "u", error: "e" }, pool);
    expect(res.json).toEqual({ ok: true, task_id: "t1", status: "pr-created" });
  });
  it("updates status without optional fields", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await post({ task_id: "t1", status: "completed" }, pool);
    expect(res.json.status).toBe("completed");
  });
  it("rejects an invalid status", async () => {
    const res = await post({ task_id: "t1", status: "bogus" });
    expect(res.statusCode).toBe(400);
  });
  it("creates a task with a known type", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c1" } as any);
    await post({ description: "do it", task_type: "review" });
    expect(createTask).toHaveBeenCalledWith("do it", "review", undefined, "remote-mcp", undefined, "normal", undefined);
  });
  it("falls back to general for an unknown type", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c2" } as any);
    await post({ description: "do it", task_type: "zzz", context: { a: 1 }, priority: "immediate" });
    expect(createTask).toHaveBeenCalledWith("do it", "general", undefined, "remote-mcp", { a: 1 }, "immediate", undefined);
  });
  it("defaults to general when no task_type is provided", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c3" } as any);
    await post({ description: "do it" });
    expect(createTask).toHaveBeenCalledWith("do it", "general", undefined, "remote-mcp", undefined, "normal", undefined);
  });
  it("threads group_id through to createTask when provided", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c4" } as any);
    await post({ description: "do it", group_id: "g-1" });
    expect(createTask).toHaveBeenCalledWith("do it", "general", undefined, "remote-mcp", undefined, "normal", "g-1");
  });
  it("returns 400 when description is blank", async () => {
    const res = await post({ description: "   " });
    expect(res.statusCode).toBe(400);
  });
  it("returns 500 on invalid JSON", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/task", method: "POST", headers: AUTH, body: "{bad" }), res, makePool() as any);
    expect(res.statusCode).toBe(500);
  });
  it("cancel issues the guarded tasks UPDATE with the task_id", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    await post({ action: "cancel", task_id: "t1" }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("status = 'cancelled'");
    expect(sql).toContain("status NOT IN ('completed', 'failed', 'cancelled', 'merged')");
    expect(params).toEqual(["t1"]);
  });
  it("set-priority updates only pending tasks with the resolved priority", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    await post({ action: "set-priority", task_id: "t1", priority: "immediate" }, pool);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("status = 'pending'");
    expect(params).toEqual(["immediate", "t1"]);
  });
  it("set-priority without a priority falls through to create and 400s", async () => {
    const res = await post({ action: "set-priority", task_id: "t1" });
    expect(res.statusCode).toBe(400);
    expect(res.json).toEqual({ error: "description is required" });
  });
});
