import { describe, it, expect } from "vitest";
import {
  cancelPipelineTask as cancelTask,
  retryPipelineTask as retryTask,
  getPipelineTask as getTask,
  listPipelineTasks as listTasks,
} from "@re-cinq/lore-shared";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const TASK_ID = "11111111-1111-1111-1111-111111111111";

describe("getTask", () => {
  it("returns null when no task row matches the id", async () => {
    const pool = makePool();

    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await getTask(pool, TASK_ID)).toBeNull();
  });

  it("returns the task with its ordered events when the id matches", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: TASK_ID, status: "running", target_repo: "re-cinq/lore" }],
      })
      .mockResolvedValueOnce({
        rows: [{ task_id: TASK_ID, to_status: "pending" }],
      });
    expect(await getTask(pool, TASK_ID)).toEqual({
      id: TASK_ID,
      status: "running",
      target_repo: "re-cinq/lore",
      events: [{ task_id: TASK_ID, to_status: "pending" }],
    });
  });
});

describe("listTasks", () => {
  it("returns all rows with a total count when no status filter is given", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: TASK_ID, status: "running" }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    expect(await listTasks(pool)).toEqual({
      tasks: [{ id: TASK_ID, status: "running" }],
      total: 1,
    });
  });

  it("returns the filtered rows and matching total when a status is given", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: TASK_ID, status: "failed" }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    expect(await listTasks(pool, "failed", 5)).toEqual({
      tasks: [{ id: TASK_ID, status: "failed" }],
      total: 1,
    });
  });
});

describe("cancelTask", () => {
  it("returns cancelled status when the task is running", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: TASK_ID, status: "running" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: "running" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await cancelTask(pool, TASK_ID)).toEqual({
      task_id: TASK_ID,
      status: "cancelled",
    });
  });

  it("throws task not found when no row matches", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(cancelTask(pool, TASK_ID)).rejects.toThrow(
      new Error("Task not found"),
    );
  });

  it("throws cannot cancel when the task is already merged", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: TASK_ID, status: "merged" }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(cancelTask(pool, TASK_ID)).rejects.toThrow(
      new Error("Cannot cancel task in merged state"),
    );
  });
});

describe("retryTask", () => {
  it("creates a linked task when the original is failed", async () => {
    const pool = makePool();
    const NEW_ID = "22222222-2222-2222-2222-222222222222";

    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: TASK_ID,
            status: "failed",
            description: "do x",
            task_type: "general",
            target_repo: "re-cinq/lore",
            created_by: "mcp",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: NEW_ID,
            status: "pending",
            priority: "normal",
            created_at: "2026-06-10",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: "failed" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await retryTask(pool, TASK_ID)).toEqual({
      task_id: NEW_ID,
      status: "pending",
      retry_of: TASK_ID,
    });
  });

  it("throws cannot retry when the task is still running", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: TASK_ID, status: "running" }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(retryTask(pool, TASK_ID)).rejects.toThrow(
      new Error(
        "Cannot retry task in running state (must be failed or needs-human-help)",
      ),
    );
  });

  it("throws task not found when no row matches", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(retryTask(pool, TASK_ID)).rejects.toThrow(
      new Error("Task not found"),
    );
  });
});
