import { describe, it, expect } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import {
  syncTasksToDb,
  getReadyTasks,
  claimTask,
  completeTask,
} from "@re-cinq/lore-server-core/features/pipeline/tasks.js";
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

// getReadyTasks / claimTask / completeTask delegate to the shared PgTaskQueue;
// the queue SQL is covered in libs/shared/.../task-queue.test.ts. These assert
// the delegation + the mcp-specific audit events.

describe("getReadyTasks", () => {
  it("returns the repo-scoped ready set the shared queue produces", async () => {
    const pool = makePool();
    const rows = [
      {
        id: "uuid-1",
        description: "A",
        context_bundle: { spec_task_id: "T001" },
        target_repo: "re-cinq/lore",
        task_group_id: null,
      },
    ];
    pool.query.mockResolvedValueOnce({ rows });

    const result = await getReadyTasks(pool, "re-cinq/lore");

    expect(result).toEqual(rows);
    expect(pool.query.mock.calls[0][0]).toContain("t.target_repo = $1");
    expect(pool.query.mock.calls[0][1]).toEqual(["re-cinq/lore"]);
  });

  it("returns an empty list when no tasks are ready", async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await getReadyTasks(pool, "re-cinq/lore")).toEqual([]);
  });
});

describe("claimTask", () => {
  it("returns true and records the claim event when a pending task is claimed", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "uuid-1" }] }) // claim CAS wins
      .mockResolvedValueOnce({ rows: [] }); // recordEvent INSERT

    const claimed = await claimTask(pool, "uuid-1", "agent-7");

    expect(claimed).toBe(true);
    expect(pool.query.mock.calls[0][0]).toContain("status = 'running'");
    expect(pool.query.mock.calls[0][1]).toEqual(["uuid-1", "agent-7"]);
    expect(pool.query.mock.calls[1][0]).toContain("pipeline.task_events");
    expect(pool.query.mock.calls[1][1][3]).toContain("lore_claim_task");
  });

  it("returns false and records no event when the row is already claimed", async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [] }); // claim CAS loses

    const claimed = await claimTask(pool, "uuid-1", "agent-7");

    expect(claimed).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("still returns true when the event-recording insert throws", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "uuid-1" }] }) // claim wins
      .mockRejectedValueOnce(new Error("task_events missing")); // event fails

    expect(await claimTask(pool, "uuid-1", "agent-7")).toBe(true);
  });
});

describe("completeTask", () => {
  it("returns completed false when the task does not exist", async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [] });

    expect(await completeTask(pool, "missing")).toEqual({
      completed: false,
      unblocked: [],
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("returns completed false when the task is not running", async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({
      rows: [
        { status: "pending", context_bundle: {}, target_repo: "re-cinq/lore" },
      ],
    });

    expect(await completeTask(pool, "uuid-1")).toEqual({
      completed: false,
      unblocked: [],
    });
  });

  it("marks a running task completed and records the transition, no slug scan", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            status: "running",
            context_bundle: {},
            target_repo: "re-cinq/lore",
          },
        ],
      }) // load
      .mockResolvedValueOnce({ rows: [] }) // UPDATE completed
      .mockResolvedValueOnce({ rows: [] }); // recordEvent INSERT

    const result = await completeTask(pool, "uuid-1");

    expect(result).toEqual({ completed: true, unblocked: [] });
    expect(pool.query.mock.calls[1][0]).toContain("status = 'completed'");
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it("returns formatted descriptors for newly unblocked same-spec dependents", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            status: "running",
            context_bundle: { spec_task_id: "T001", spec_slug: "auth" },
            target_repo: "re-cinq/lore",
          },
        ],
      }) // load
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({
        rows: [
          {
            id: "uuid-2",
            description: "Build B",
            context_bundle: {
              spec_task_id: "T002",
              spec_slug: "auth",
              depends_on: ["T001"],
            },
          },
          {
            id: "uuid-3",
            description: "Build C",
            context_bundle: {
              spec_task_id: "T003",
              spec_slug: "auth",
              depends_on: ["T001"],
            },
          },
        ],
      }) // findReadySpecTasks
      .mockResolvedValueOnce({ rows: [] }); // recordEvent INSERT

    const result = await completeTask(pool, "uuid-1");

    expect(result).toEqual({
      completed: true,
      unblocked: ["T002: Build B", "T003: Build C"],
    });
  });
});
