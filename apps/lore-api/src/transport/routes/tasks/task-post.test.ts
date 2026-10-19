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

const NO_TYPED_TASKS =
  "Lore no longer runs typed tasks, so nothing is created here. To have something implemented or written, open an issue with a priority:high, priority:medium or priority:low label and the implementation loop picks it up. To have a feature specified, start a plan on the repository's Plans page. Every open pull request is reviewed already; comment `@lore review` on one to have it reviewed again.";

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

  it("answers 409 with the reason when retrying a failed implementation task, whose type was removed", async () => {
    vi.mocked(retryTask).mockRejectedValue(
      new Error('The "implementation" task type was removed.'),
    );
    const res = await post({ action: "retry", task_id: "old" });

    expect(res.statusCode).toBe(409);
    expect(res.result).toEqual({
      error: 'The "implementation" task type was removed.',
    });
  });

  it("answers 404 when retrying a task that does not exist", async () => {
    vi.mocked(retryTask).mockRejectedValue(new Error("Task not found"));
    const res = await post({ action: "retry", task_id: "gone" });

    expect(res.statusCode).toBe(404);
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

  it("queues no revision of task t1 and points at a review on its pull request", async () => {
    const pool = makePool();
    const res = await post(
      { action: "revise", task_id: "t1", feedback: "tighten it" },
      pool,
    );

    expect(res.statusCode).toBe(409);
    expect(res.result).toEqual({
      error:
        "A task is no longer revised from here. Leave the feedback as a review that requests changes on its pull request: Lore answers it there.",
    });
    expect(pool.query).not.toHaveBeenCalled();
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

  it.each(["review", "runbook", "gap-fill", "feature-request", "general"])(
    "creates no %s task and says where that work goes now",
    async (taskType) => {
      const res = await post(
        { description: "do it", task_type: taskType },
        poolWithDefinition(taskType, "claude-code"),
      );

      expect(res.statusCode).toBe(400);
      expect(res.result).toEqual({ error: NO_TYPED_TASKS });
      expect(createTask).not.toHaveBeenCalled();
    },
  );

  it("creates nothing for a body that names neither a task nor a type", async () => {
    const res = await post({ description: "do it" });

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: NO_TYPED_TASKS });
  });

  it("returns 400 on invalid JSON, not 500", async () => {
    const res = await post("{bad");

    expect(res.statusCode).toBe(400);
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

  it("set-priority without a priority changes nothing and answers 400", async () => {
    const res = await post({ action: "set-priority", task_id: "t1" });

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: NO_TYPED_TASKS });
  });
});
