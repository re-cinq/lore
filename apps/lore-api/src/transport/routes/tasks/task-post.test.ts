import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
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

  function poolWithDefinition(name: string, executionMode: string) {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [
        {
          name,
          model: "claude-sonnet-4-6",
          timeout_minutes: 30,
          prompt: "Do it.",
          image: null,
          execution_mode: executionMode,
          review_required: false,
          project_id: null,
          config: null,
        },
      ],
    });

    return pool;
  }

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
        rows: [
          { id: "t1", status: "pr-created", task_type: "feature-request" },
        ],
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

  it("answers 409 when revising a runbook task, pointing at a review on its pull request", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: "t1", status: "pr-created", task_type: "runbook" }],
      })
      .mockResolvedValue({ rows: [] });
    const res = await post(
      { action: "revise", task_id: "t1", feedback: "tighten it" },
      pool,
    );

    expect(res.statusCode).toBe(409);
    expect(res.result).toEqual({
      error:
        "Only a feature-request task is revised from here. For any other pull request, leave the feedback as a review that requests changes: Lore answers it on the pull request.",
    });
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

  it("returns 409 when revising with no feedback field at all", async () => {
    const res = await post(
      { action: "revise", task_id: "t1" },
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

  it("creates a review task when lore.agent_definitions holds a review row", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c1" } as any);
    await post(
      { description: "do it", task_type: "review" },
      poolWithDefinition("review", "claude-code"),
    );
    expect(createTask).toHaveBeenCalledWith({
      description: "do it",
      taskType: "review",
      createdBy: "remote-mcp",
      priority: "normal",
    });
  });

  it("attributes the task to the caller-supplied created_by", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "t1" } as never);
    await post(
      { description: "d", task_type: "runbook", created_by: "bogdan@re-cinq.com" },
      poolWithDefinition("runbook", "claude-code"),
    );

    expect(createTask).toHaveBeenCalledWith({
      description: "d",
      taskType: "runbook",
      createdBy: "bogdan@re-cinq.com",
      priority: "normal",
    });
  });

  it("attributes to remote-mcp when the caller names nobody", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "t1" } as never);
    await post({ description: "d", task_type: "runbook" }, poolWithDefinition("runbook", "claude-code"));

    expect(createTask).toHaveBeenCalledWith({
      description: "d",
      taskType: "runbook",
      createdBy: "remote-mcp",
      priority: "normal",
    });
  });

  it("refuses a zzz type no definition row names, creating nothing", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await post({ description: "do it", task_type: "zzz" }, pool);

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({
      error:
        '"zzz" is not a task type: no agent definition of that name can run a task',
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("refuses def-validate, a station recipe no task can run as", async () => {
    const res = await post(
      { description: "do it", task_type: "def-validate" },
      poolWithDefinition("def-validate", "station"),
    );

    expect(res.statusCode).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("refuses a task with no task_type and points at the implementation loop", async () => {
    const res = await post({ description: "do it" });

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({
      error:
        "task_type is required: a task with no type has nothing to run it. To have something implemented, open an issue with a priority:high, priority:medium or priority:low label and the implementation loop picks it up.",
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it.each(["implementation", "general"])(
    "refuses the removed %s task type and points at the implementation loop",
    async (removed) => {
      const res = await post({ description: "do it", task_type: removed });

      expect(res.statusCode).toBe(400);
      expect(res.result).toMatchObject({
        error: expect.stringContaining(
          `The "${removed}" task type was removed.`,
        ),
      });
      expect(createTask).not.toHaveBeenCalled();
    },
  );

  it("carries the context and the priority of a runbook task through to createTask", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c2" } as any);
    await post(
      {
        description: "do it",
        task_type: "runbook",
        context: { a: 1 },
        priority: "immediate",
      },
      poolWithDefinition("runbook", "claude-code"),
    );
    expect(createTask).toHaveBeenCalledWith({
      description: "do it",
      taskType: "runbook",
      createdBy: "remote-mcp",
      contextBundle: { a: 1 },
      priority: "immediate",
    });
  });

  it("threads group_id through to createTask when provided", async () => {
    vi.mocked(createTask).mockResolvedValue({ task_id: "c4" } as any);
    await post(
      { description: "do it", task_type: "runbook", group_id: "g-1" },
      poolWithDefinition("runbook", "claude-code"),
    );
    expect(createTask).toHaveBeenCalledWith({
      description: "do it",
      taskType: "runbook",
      createdBy: "remote-mcp",
      priority: "normal",
      taskGroupId: "g-1",
    });
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
