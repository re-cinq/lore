import { describe, it, expect } from "vitest";
import { fakePgPool } from "../../test-helpers/fake-pg-pool.js";
import { PgTaskQueue } from "./task-queue-pg.js";
import { InMemoryTaskQueue, type SeedTask } from "./task-queue-memory.js";

describe("PgTaskQueue.claimNextPending", () => {
  it("selects one pending task, immediate-first then oldest, with the 30s grace", async () => {
    const { pool, calls } = fakePgPool([
      { rows: [{ id: "t1", status: "pending" }] },
    ]);
    const task = await new PgTaskQueue(pool).claimNextPending();

    expect(task).toEqual({ id: "t1", status: "pending" });
    expect(calls[0].text).toContain("WHERE status = 'pending'");
    expect(calls[0].text).toContain("priority = 'immediate'");
    expect(calls[0].text).toContain("now() - interval '30 seconds'");
    expect(calls[0].text).toContain("LIMIT 1");
  });

  it("drops the dead `status != 'running-local'` predicate", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgTaskQueue(pool).claimNextPending();
    expect(calls[0].text).not.toContain("running-local");
  });

  it("returns null when nothing is runnable", async () => {
    const { pool } = fakePgPool([{ rows: [] }]);

    expect(await new PgTaskQueue(pool).claimNextPending()).toBeNull();
  });
});

describe("PgTaskQueue.findRecoverable", () => {
  it("filters running/queued past the minute interval", async () => {
    const { pool, calls } = fakePgPool([
      { rows: [{ id: "t1", task_type: "general" }] },
    ]);
    const rows = await new PgTaskQueue(pool).findRecoverable(30);

    expect(rows).toEqual([{ id: "t1", task_type: "general" }]);
    expect(calls[0].text).toContain("status IN ('running', 'queued')");
    expect(calls[0].text).toContain("($1 || ' minutes')::interval");
    expect(calls[0].params).toEqual(["30"]);
  });
});

describe("PgTaskQueue.claimSpecTask", () => {
  it("returns true when the CAS updates a still-pending row, defaulting the claimer", async () => {
    const { pool, calls } = fakePgPool([{ rows: [{ id: "t1" }] }]);

    expect(await new PgTaskQueue(pool).claimSpecTask("t1")).toBe(true);
    expect(calls[0].text).toContain("WHERE id = $1 AND status = 'pending'");
    expect(calls[0].text).toContain("agent_id = $2");
    expect(calls[0].params).toEqual(["t1", "spec-task-executor"]);
  });

  it("records the caller-supplied claimer", async () => {
    const { pool, calls } = fakePgPool([{ rows: [{ id: "t1" }] }]);

    expect(await new PgTaskQueue(pool).claimSpecTask("t1", "agent-9")).toBe(
      true,
    );
    expect(calls[0].params).toEqual(["t1", "agent-9"]);
  });

  it("returns false when the row was already claimed", async () => {
    const { pool } = fakePgPool([{ rows: [] }]);

    expect(await new PgTaskQueue(pool).claimSpecTask("t1")).toBe(false);
  });
});

describe("PgTaskQueue.findReadySpecTasks", () => {
  it("stays org-wide with no params when no repo is given", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgTaskQueue(pool).findReadySpecTasks();
    expect(calls[0].text).not.toContain("t.target_repo = $1");
    expect(calls[0].params).toEqual([]);
  });

  it("scopes to one repo when given", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgTaskQueue(pool).findReadySpecTasks("a/b");
    expect(calls[0].text).toContain("AND t.target_repo = $1");
    expect(calls[0].params).toEqual(["a/b"]);
  });
});

describe("PgTaskQueue.completeSpecTask", () => {
  it("returns completed false for an unknown task", async () => {
    const { pool } = fakePgPool([{ rows: [] }]);

    expect(await new PgTaskQueue(pool).completeSpecTask("missing")).toEqual({
      completed: false,
      unblocked: [],
    });
  });

  it("returns completed false when the task is not running", async () => {
    const { pool } = fakePgPool([
      { rows: [{ status: "pending", context_bundle: {}, target_repo: "a/b" }] },
    ]);

    expect(await new PgTaskQueue(pool).completeSpecTask("t1")).toEqual({
      completed: false,
      unblocked: [],
    });
  });

  it("flips to completed and skips the readiness scan without slug metadata", async () => {
    const { pool, calls } = fakePgPool([
      { rows: [{ status: "running", context_bundle: {}, target_repo: "a/b" }] },
      { rows: [] },
    ]);

    expect(await new PgTaskQueue(pool).completeSpecTask("t1")).toEqual({
      completed: true,
      unblocked: [],
    });
    expect(calls[1].text).toContain("status = 'completed'");
    expect(calls).toHaveLength(2);
  });

  it("reports same-spec dependents unblocked by the completion", async () => {
    const { pool } = fakePgPool([
      {
        rows: [
          {
            status: "running",
            context_bundle: { spec_task_id: "T1", spec_slug: "x" },
            target_repo: "a/b",
          },
        ],
      },
      { rows: [] },
      {
        rows: [
          {
            id: "u2",
            description: "Build B",
            context_bundle: {
              spec_task_id: "T2",
              spec_slug: "x",
              depends_on: ["T1"],
            },
          },
          {
            id: "u3",
            description: "Other slug",
            context_bundle: {
              spec_task_id: "T9",
              spec_slug: "y",
              depends_on: ["T1"],
            },
          },
          {
            id: "u4",
            description: "Unrelated dep",
            context_bundle: {
              spec_task_id: "T4",
              spec_slug: "x",
              depends_on: ["T0"],
            },
          },
        ],
      },
    ]);

    expect(await new PgTaskQueue(pool).completeSpecTask("t1")).toEqual({
      completed: true,
      unblocked: ["T2: Build B"],
    });
  });
});

describe("PgTaskQueue org-wide reads", () => {
  it("awaitingApproval selects approval-gated tasks carrying an issue", async () => {
    const { pool, calls } = fakePgPool([
      { rows: [{ id: "t1", target_repo: "a/b", issue_number: 7 }] },
    ]);
    const rows = await new PgTaskQueue(pool).awaitingApproval();

    expect(rows).toEqual([{ id: "t1", target_repo: "a/b", issue_number: 7 }]);
    expect(calls[0].text).toContain("status = 'awaiting_approval'");
    expect(calls[0].text).toContain("issue_number IS NOT NULL");
  });

  it("distinctTargetRepos returns the ascending non-null repo set", async () => {
    const { pool, calls } = fakePgPool([
      { rows: [{ target_repo: "a/b" }, { target_repo: "c/d" }] },
    ]);

    expect(await new PgTaskQueue(pool).distinctTargetRepos()).toEqual([
      "a/b",
      "c/d",
    ]);
    expect(calls[0].text).toContain("SELECT DISTINCT target_repo");
    expect(calls[0].text).toContain("target_repo IS NOT NULL");
  });

  it("prInfo returns the PR coordinates for one task id", async () => {
    const { pool, calls } = fakePgPool([
      { rows: [{ pr_number: 12, target_repo: "a/b", target_branch: "main" }] },
    ]);

    expect(await new PgTaskQueue(pool).prInfo("t1")).toEqual({
      pr_number: 12,
      target_repo: "a/b",
      target_branch: "main",
    });
    expect(calls[0].text).toContain("pr_number, target_repo, target_branch");
    expect(calls[0].params).toEqual(["t1"]);
  });

  it("prInfo returns null for an unknown task", async () => {
    const { pool } = fakePgPool([{ rows: [] }]);

    expect(await new PgTaskQueue(pool).prInfo("nope")).toBeNull();
  });
});

const at = (now: number, deltaSec: number) =>
  new Date(now - deltaSec * 1000).toISOString();

describe("InMemoryTaskQueue.claimNextPending", () => {
  const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);
  const queue = (tasks: SeedTask[]) => new InMemoryTaskQueue(tasks, () => NOW);

  it("picks an immediate task with no grace delay", async () => {
    const q = queue([
      {
        id: "i",
        status: "pending",
        priority: "immediate",
        created_at: at(NOW, 0),
      },
    ]);

    expect((await q.claimNextPending())?.id).toBe("i");
  });

  it("withholds a normal task at exactly the 30s boundary — eligibility needs age strictly greater than 30s", async () => {
    for (const ageSec of [29, 30]) {
      expect(
        await queue([
          {
            id: "n",
            status: "pending",
            priority: "normal",
            created_at: at(NOW, ageSec),
          },
        ]).claimNextPending(),
      ).toBeNull();
    }
    expect(
      (
        await queue([
          {
            id: "n",
            status: "pending",
            priority: "normal",
            created_at: at(NOW, 31),
          },
        ]).claimNextPending()
      )?.id,
    ).toBe("n");
  });

  it("ignores non-pending tasks", async () => {
    for (const status of ["running-local", "running", "completed"]) {
      expect(
        await queue([
          { id: "x", status, priority: "immediate", created_at: at(NOW, 0) },
        ]).claimNextPending(),
      ).toBeNull();
    }
  });

  it("orders immediate before normal, then oldest first", async () => {
    const q = queue([
      {
        id: "normal-old",
        status: "pending",
        priority: "normal",
        created_at: at(NOW, 100),
      },
      {
        id: "immediate-new",
        status: "pending",
        priority: "immediate",
        created_at: at(NOW, 1),
      },
      {
        id: "normal-older",
        status: "pending",
        priority: "normal",
        created_at: at(NOW, 200),
      },
    ]);

    expect((await q.claimNextPending())?.id).toBe("immediate-new");
  });
});

describe("InMemoryTaskQueue sweeps", () => {
  const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);

  it("findRecoverable returns running/queued idle past the window", async () => {
    const q = new InMemoryTaskQueue(
      [
        {
          id: "stale",
          status: "running",
          task_type: "general",
          updated_at: at(NOW, 31 * 60),
        },
        {
          id: "fresh",
          status: "running",
          task_type: "general",
          updated_at: at(NOW, 60),
        },
        {
          id: "impl",
          status: "queued",
          task_type: "implementation",
          updated_at: at(NOW, 40 * 60),
        },
      ],
      () => NOW,
    );

    expect((await q.findRecoverable(30)).map((r) => r.id)).toEqual([
      "stale",
      "impl",
    ]);
  });

  it("findStaleRunning returns running tasks older than the hour threshold with age", async () => {
    const q = new InMemoryTaskQueue(
      [
        {
          id: "old",
          status: "running",
          task_type: "review",
          target_repo: "a/b",
          created_at: at(NOW, 7 * 3600),
          issue_number: 5,
        },
      ],
      () => NOW,
    );
    const stale = await q.findStaleRunning(6);

    expect(stale).toMatchObject([
      { id: "old", target_repo: "a/b", issue_number: 5 },
    ]);
    expect(stale[0].age_hours).toBeCloseTo(7, 5);
  });
});

describe("InMemoryTaskQueue.claimSpecTask", () => {
  it("claims a pending spec-task once (CAS)", async () => {
    const q = new InMemoryTaskQueue([
      { id: "s", status: "pending", task_type: "spec-task" },
    ]);

    expect(await q.claimSpecTask("s")).toBe(true);
    expect(await q.claimSpecTask("s")).toBe(false);
  });

  it("records the claimer, defaulting to spec-task-executor", async () => {
    const tasks: SeedTask[] = [
      { id: "a", status: "pending", task_type: "spec-task" },
      { id: "b", status: "pending", task_type: "spec-task" },
    ];
    const q = new InMemoryTaskQueue(tasks);

    await q.claimSpecTask("a");
    await q.claimSpecTask("b", "agent-9");
    expect(tasks[0].agent_id).toBe("spec-task-executor");
    expect(tasks[1].agent_id).toBe("agent-9");
  });
});

describe("InMemoryTaskQueue.completeSpecTask", () => {
  it("returns completed false when the task is not running", async () => {
    const q = new InMemoryTaskQueue([
      { id: "s", status: "pending", task_type: "spec-task" },
    ]);

    expect(await q.completeSpecTask("s")).toEqual({
      completed: false,
      unblocked: [],
    });
    expect(await q.completeSpecTask("missing")).toEqual({
      completed: false,
      unblocked: [],
    });
  });

  it("flips to completed and reports only same-spec dependents it unblocks", async () => {
    const q = new InMemoryTaskQueue([
      {
        id: "done",
        status: "running",
        task_type: "spec-task",
        target_repo: "a/b",
        context_bundle: { spec_task_id: "T1", spec_slug: "x" },
      },
      {
        id: "dep",
        status: "pending",
        task_type: "spec-task",
        target_repo: "a/b",
        description: "Build the thing",
        context_bundle: {
          spec_task_id: "T2",
          spec_slug: "x",
          depends_on: ["T1"],
        },
      },
      {
        id: "other",
        status: "pending",
        task_type: "spec-task",
        target_repo: "a/b",
        context_bundle: {
          spec_task_id: "T3",
          spec_slug: "y",
          depends_on: ["T1"],
        },
      },
    ]);

    expect(await q.completeSpecTask("done")).toEqual({
      completed: true,
      unblocked: ["T2: Build the thing"],
    });
  });
});

describe("InMemoryTaskQueue org-wide reads", () => {
  it("awaitingApproval returns only approval-gated tasks with an issue", async () => {
    const q = new InMemoryTaskQueue([
      {
        id: "a",
        status: "awaiting_approval",
        target_repo: "a/b",
        issue_number: 3,
      },
      {
        id: "b",
        status: "awaiting_approval",
        target_repo: "a/b",
        issue_number: null,
      },
      { id: "c", status: "pending", target_repo: "a/b", issue_number: 9 },
    ]);

    expect(await q.awaitingApproval()).toEqual([
      { id: "a", target_repo: "a/b", issue_number: 3 },
    ]);
  });

  it("distinctTargetRepos returns the ascending unique repo set", async () => {
    const q = new InMemoryTaskQueue([
      { id: "1", target_repo: "c/d" },
      { id: "2", target_repo: "a/b" },
      { id: "3", target_repo: "a/b" },
    ]);

    expect(await q.distinctTargetRepos()).toEqual(["a/b", "c/d"]);
  });

  it("prInfo returns PR coordinates or null", async () => {
    const q = new InMemoryTaskQueue([
      { id: "1", target_repo: "a/b", pr_number: 5, target_branch: "main" },
    ]);

    expect(await q.prInfo("1")).toEqual({
      pr_number: 5,
      target_repo: "a/b",
      target_branch: "main",
    });
    expect(await q.prInfo("missing")).toBeNull();
  });
});

describe("InMemoryTaskQueue.findReadySpecTasks", () => {
  it("returns only spec-tasks whose deps are completed/merged in the same spec", async () => {
    const q = new InMemoryTaskQueue([
      {
        id: "dep",
        status: "completed",
        task_type: "spec-task",
        target_repo: "a/b",
        context_bundle: { spec_task_id: "T1", spec_slug: "x" },
      },
      {
        id: "ready",
        status: "pending",
        task_type: "spec-task",
        target_repo: "a/b",
        context_bundle: {
          spec_task_id: "T2",
          spec_slug: "x",
          depends_on: ["T1"],
        },
      },
      {
        id: "blocked",
        status: "pending",
        task_type: "spec-task",
        target_repo: "a/b",
        context_bundle: {
          spec_task_id: "T3",
          spec_slug: "x",
          depends_on: ["T9"],
        },
      },
    ]);

    expect((await q.findReadySpecTasks()).map((t) => t.id)).toEqual(["ready"]);
  });

  it("scopes the returned set to one repo, still resolving deps org-wide", async () => {
    const q = new InMemoryTaskQueue([
      {
        id: "dep-a",
        status: "completed",
        task_type: "spec-task",
        target_repo: "a/b",
        context_bundle: { spec_task_id: "T1", spec_slug: "x" },
      },
      {
        id: "ready-a",
        status: "pending",
        task_type: "spec-task",
        target_repo: "a/b",
        context_bundle: {
          spec_task_id: "T2",
          spec_slug: "x",
          depends_on: ["T1"],
        },
      },
      {
        id: "dep-c",
        status: "completed",
        task_type: "spec-task",
        target_repo: "c/d",
        context_bundle: { spec_task_id: "T1", spec_slug: "x" },
      },
      {
        id: "ready-c",
        status: "pending",
        task_type: "spec-task",
        target_repo: "c/d",
        context_bundle: {
          spec_task_id: "T2",
          spec_slug: "x",
          depends_on: ["T1"],
        },
      },
    ]);

    expect((await q.findReadySpecTasks("a/b")).map((t) => t.id)).toEqual([
      "ready-a",
    ]);
  });
});

describe("countUnmergedInGroup", () => {
  it("PgTaskQueue counts group rows whose status is not merged", async () => {
    const { pool, calls } = fakePgPool([{ rows: [{ cnt: "2" }] }]);

    expect(await new PgTaskQueue(pool).countUnmergedInGroup("g1")).toBe(2);
    expect(calls[0].text).toContain("task_group_id = $1");
    expect(calls[0].text).toContain("status <> 'merged'");
    expect(calls[0].params).toEqual(["g1"]);
  });

  it("PgTaskQueue returns 0 when the count row is absent", async () => {
    const { pool } = fakePgPool([{ rows: [] }]);

    expect(await new PgTaskQueue(pool).countUnmergedInGroup("g1")).toBe(0);
  });

  it("InMemory returns >0 while a sibling is unmerged, 0 when all merged", async () => {
    const seed: SeedTask[] = [
      { id: "a", task_group_id: "g1", status: "merged" },
      { id: "b", task_group_id: "g1", status: "review" },
      { id: "c", task_group_id: "g2", status: "pending" },
    ];
    const q = new InMemoryTaskQueue(seed);

    expect(await q.countUnmergedInGroup("g1")).toBe(1);
    seed[1].status = "merged";
    expect(await q.countUnmergedInGroup("g1")).toBe(0);
    expect(await q.countUnmergedInGroup("g2")).toBe(1);
  });
});

describe("setColumns", () => {
  it("PgTaskQueue writes only the given allow-listed columns, without status or updated_at", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgTaskQueue(pool).setColumns("t1", {
      issue_number: 7,
      issue_url: "https://github.com/a/b/issues/7",
    });
    expect(calls[0].text).toContain(
      "UPDATE pipeline.tasks SET issue_number = $1, issue_url = $2 WHERE id = $3",
    );
    expect(calls[0].text).not.toContain("status");
    expect(calls[0].text).not.toContain("updated_at");
    expect(calls[0].params).toEqual([
      7,
      "https://github.com/a/b/issues/7",
      "t1",
    ]);
  });

  it("PgTaskQueue throws on a column outside SETTABLE_TASK_COLUMNS instead of silently dropping it", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await expect(
      new PgTaskQueue(pool).setColumns("t1", { statuss: "merged" }),
    ).rejects.toThrow(
      new Error(
        'setColumns: unknown task column "statuss" (not in SETTABLE_TASK_COLUMNS)',
      ),
    );
    expect(calls).toHaveLength(0);
  });

  it("PgTaskQueue issues no SQL for an empty column set", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgTaskQueue(pool).setColumns("t1", {});
    expect(calls).toHaveLength(0);
  });

  it("InMemory assigns allow-listed columns onto the seeded task", async () => {
    const seed: SeedTask[] = [{ id: "t1", status: "running" }];
    const q = new InMemoryTaskQueue(seed);

    await q.setColumns("t1", { review_iteration: 2, pr_number: 12 });
    expect(seed[0]).toMatchObject({
      status: "running",
      review_iteration: 2,
      pr_number: 12,
    });
  });

  it("InMemory throws on a column outside SETTABLE_TASK_COLUMNS, mirroring the Pg adapter", async () => {
    const seed: SeedTask[] = [{ id: "t1", status: "running" }];
    const q = new InMemoryTaskQueue(seed);

    await expect(q.setColumns("t1", { issue_numberr: 7 })).rejects.toThrow(
      new Error(
        'setColumns: unknown task column "issue_numberr" (not in SETTABLE_TASK_COLUMNS)',
      ),
    );
    expect(seed[0]).toEqual({ id: "t1", status: "running" });
  });

  it("InMemory is a no-op for an unknown task id", async () => {
    const q = new InMemoryTaskQueue([{ id: "t1" }]);

    await q.setColumns("missing", { issue_number: 7 });
    expect(q.tasks).toEqual([{ id: "t1" }]);
  });
});
