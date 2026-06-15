import { describe, it, expect } from "vitest";
import { makePool } from "../../test-helpers/http-mock.js";
import {
  syncTasksToDb,
  getReadyTasks,
  claimTask,
  completeTask,
} from "./tasks.js";
import type { ParsedTask } from "@re-cinq/lore-shared";

function parsed(overrides: Partial<ParsedTask>): ParsedTask {
  return {
    specTaskId: "T001",
    description: "Do the thing",
    completed: false,
    parallelizable: false,
    dependsOn: [],
    phase: 1,
    filePath: undefined,
    ...overrides,
  };
}

describe("syncTasksToDb", () => {
  it("inserts a new task and counts it as created", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // existence check: none
      .mockResolvedValueOnce({ rows: [] }); // insert

    const result = await syncTasksToDb(pool, "re-cinq/lore", "auth", [
      parsed({ specTaskId: "T001" }),
    ]);

    expect(result).toEqual({ synced: 1, created: 1 });
    const insertSql = pool.query.mock.calls[1][0];
    expect(insertSql).toContain("INSERT INTO pipeline.tasks");
    expect(pool.query.mock.calls[1][1]).toContain("T001: Do the thing");
  });

  it("updates an existing task without counting it as created", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "uuid-1", status: "pending" }] }) // exists
      .mockResolvedValueOnce({ rows: [] }); // update

    const result = await syncTasksToDb(pool, "re-cinq/lore", "auth", [
      parsed({ specTaskId: "T001" }),
    ]);

    expect(result).toEqual({ synced: 1, created: 0 });
    expect(pool.query.mock.calls[1][0]).toContain("UPDATE pipeline.tasks");
    expect(pool.query.mock.calls[1][1]).toContain("uuid-1");
  });

  it("persists completed tasks with status completed", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await syncTasksToDb(pool, "re-cinq/lore", "auth", [
      parsed({ specTaskId: "T002", completed: true }),
    ]);

    // status param is the 3rd positional value in the no-group insert
    expect(pool.query.mock.calls[1][1][2]).toBe("completed");
  });

  it("threads task_group_id into the grouped insert", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await syncTasksToDb(
      pool,
      "re-cinq/lore",
      "auth",
      [parsed({ specTaskId: "T001" })],
      "group-9",
    );

    const insertSql = pool.query.mock.calls[1][0];
    expect(insertSql).toContain("task_group_id");
    expect(pool.query.mock.calls[1][1]).toContain("group-9");
  });

  it("counts only new tasks as created across a mixed batch", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "uuid-1", status: "pending" }] }) // T001 exists
      .mockResolvedValueOnce({ rows: [] }) // T001 update
      .mockResolvedValueOnce({ rows: [] }) // T002 not found
      .mockResolvedValueOnce({ rows: [] }); // T002 insert

    const result = await syncTasksToDb(pool, "re-cinq/lore", "auth", [
      parsed({ specTaskId: "T001" }),
      parsed({ specTaskId: "T002" }),
    ]);

    expect(result).toEqual({ synced: 2, created: 1 });
  });
});

describe("getReadyTasks", () => {
  it("returns the rows the dependency query produces", async () => {
    const pool = makePool();
    const rows = [
      { id: "uuid-1", description: "T001: A", status: "pending", context_bundle: { spec_task_id: "T001" }, agent_id: null },
    ];
    pool.query.mockResolvedValueOnce({ rows });

    const result = await getReadyTasks(pool, "re-cinq/lore");

    expect(result).toEqual(rows);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("NOT EXISTS");
    expect(pool.query.mock.calls[0][1]).toEqual(["re-cinq/lore"]);
  });

  it("returns an empty list when no tasks are ready", async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await getReadyTasks(pool, "re-cinq/lore")).toEqual([]);
  });
});

describe("claimTask", () => {
  it("commits and returns true when a pending task is locked", async () => {
    const pool = makePool();
    const client = pool.__client;
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: "uuid-1" }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    const claimed = await claimTask(pool, "uuid-1", "agent-7");

    expect(claimed).toBe(true);
    const updateCall = client.query.mock.calls[2];
    expect(updateCall[0]).toContain("status = 'running'");
    expect(updateCall[1]).toEqual(["uuid-1", "agent-7"]);
    expect(client.query.mock.calls[4][0]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("rolls back and returns false when the row is already locked or absent", async () => {
    const pool = makePool();
    const client = pool.__client;
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE: nothing
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const claimed = await claimTask(pool, "uuid-1", "agent-7");

    expect(claimed).toBe(false);
    expect(client.query.mock.calls[2][0]).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  it("still commits when the event-recording insert throws", async () => {
    const pool = makePool();
    const client = pool.__client;
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: "uuid-1" }] }) // SELECT
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockRejectedValueOnce(new Error("task_events missing")) // INSERT event fails
      .mockResolvedValueOnce(undefined); // COMMIT

    const claimed = await claimTask(pool, "uuid-1", "agent-7");

    expect(claimed).toBe(true);
    expect(client.query.mock.calls[4][0]).toBe("COMMIT");
  });
});

describe("completeTask", () => {
  it("returns completed false when the task does not exist", async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await completeTask(pool, "missing");
    expect(result).toEqual({ completed: false, unblocked: [] });
  });

  it("returns completed false when the task is not running", async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "uuid-1", status: "pending", context_bundle: {}, target_repo: "re-cinq/lore" }],
    });

    const result = await completeTask(pool, "uuid-1");
    expect(result).toEqual({ completed: false, unblocked: [] });
  });

  it("marks a running task completed with no unblocked dependents", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: "uuid-1", status: "running", context_bundle: { spec_task_id: "T001", spec_slug: "auth" }, target_repo: "re-cinq/lore" }],
      }) // load
      .mockResolvedValueOnce({ rows: [] }) // UPDATE completed
      .mockResolvedValueOnce({ rows: [] }) // INSERT event
      .mockResolvedValueOnce({ rows: [] }); // dependents query: none

    const result = await completeTask(pool, "uuid-1");
    expect(result).toEqual({ completed: true, unblocked: [] });
    expect(pool.query.mock.calls[1][0]).toContain("status = 'completed'");
  });

  it("returns formatted descriptors for newly unblocked dependents", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: "uuid-1", status: "running", context_bundle: { spec_task_id: "T001", spec_slug: "auth" }, target_repo: "re-cinq/lore" }],
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // event
      .mockResolvedValueOnce({
        rows: [
          { id: "uuid-2", description: "Build B", context_bundle: { spec_task_id: "T002" } },
          { id: "uuid-3", description: "Build C", context_bundle: { spec_task_id: "T003" } },
        ],
      });

    const result = await completeTask(pool, "uuid-1");
    expect(result).toEqual({
      completed: true,
      unblocked: ["T002: Build B", "T003: Build C"],
    });
  });

  it("skips the dependents query when the completed task lacks slug metadata", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: "uuid-1", status: "running", context_bundle: {}, target_repo: "re-cinq/lore" }],
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // event

    const result = await completeTask(pool, "uuid-1");
    expect(result).toEqual({ completed: true, unblocked: [] });
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});
