import { describe, it, expect } from "vitest";
import { fakePgPool } from "../../../test-helpers/fake-pg-pool.js";
import { PgTaskQueue } from "./task-queue-pg.js";
import { InMemoryTaskQueue, type SeedTask } from "./task-queue-memory.js";

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

describe("mergeableTasks", () => {
  it("InMemory offers completed spec-task T001 with PR #2271 to the merge check, and not a completed implementation task or a spec-task with no PR", async () => {
    const q = new InMemoryTaskQueue([
      {
        id: "t001",
        task_type: "spec-task",
        status: "completed",
        pr_number: 2271,
        pr_url: "https://github.com/re-cinq/lore/pull/2271",
      },
      {
        id: "impl",
        task_type: "implementation",
        status: "completed",
        pr_number: 9,
        pr_url: "https://github.com/re-cinq/lore/pull/9",
      },
      { id: "nopr", task_type: "spec-task", status: "completed" },
    ]);

    expect((await q.mergeableTasks()).map((t) => t.id)).toEqual(["t001"]);
  });

  it("PgTaskQueue selects completed spec-tasks beside pr-created and review tasks", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgTaskQueue(pool).mergeableTasks();

    expect(calls[0].text).toContain(
      "status = 'completed' AND task_type = 'spec-task'",
    );
  });
});

describe("countUnmergedInGroup", () => {
  it("PgTaskQueue counts group rows neither merged nor cancelled", async () => {
    const { pool, calls } = fakePgPool([{ rows: [{ cnt: "2" }] }]);

    expect(await new PgTaskQueue(pool).countUnmergedInGroup("g1")).toBe(2);
    expect(calls[0].text).toContain("task_group_id = $1");
    expect(calls[0].text).toContain("status NOT IN ('merged', 'cancelled')");
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

  it("InMemory leaves out a spec-task a rerun cancelled, so the rest merging completes group g1", async () => {
    const q = new InMemoryTaskQueue([
      { id: "a", task_group_id: "g1", status: "merged" },
      { id: "dropped", task_group_id: "g1", status: "cancelled" },
    ]);

    expect(await q.countUnmergedInGroup("g1")).toBe(0);
  });
});

describe("activeTaskByIssue", () => {
  it("InMemory returns null for a retried task — retried is terminal and must not guard the issue", async () => {
    const q = new InMemoryTaskQueue([
      { id: "t1", status: "retried", target_repo: "a/b", issue_number: 85 },
    ]);

    expect(await q.activeTaskByIssue("a/b", 85)).toBeNull();
  });

  it("InMemory returns the completed task t1 for issue 85, since a completed task's pull request still awaits review", async () => {
    const q = new InMemoryTaskQueue([
      { id: "t1", status: "completed", target_repo: "a/b", issue_number: 85 },
    ]);

    expect(await q.activeTaskByIssue("a/b", 85)).toEqual({ id: "t1" });
  });

  it("PgTaskQueue SQL treats only failed, cancelled and retried tasks as no longer guarding the issue", async () => {
    const { pool, calls } = fakePgPool([{ rows: [] }]);

    await new PgTaskQueue(pool).activeTaskByIssue("a/b", 85);
    expect(calls[0].text).toContain(
      "status NOT IN ('failed', 'cancelled', 'retried')",
    );
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
