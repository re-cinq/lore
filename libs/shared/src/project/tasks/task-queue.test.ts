import { describe, it, expect, vi } from "vitest";
import { PgTaskQueue } from "./task-queue-pg.js";
import { InMemoryTaskQueue, type SeedTask } from "./task-queue-memory.js";

// ── pg.Pool mock ───────────────────────────────────────────────────────

type Call = { sql: string; values: unknown[] };

function mockPool(responses: Array<{ rows?: unknown[] }>) {
  const calls: Call[] = [];
  let i = 0;
  const pool = {
    query: vi.fn(async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      return { rows: responses[i++]?.rows ?? [] };
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pool: pool as any, calls };
}

// ── PgTaskQueue: SQL shape ─────────────────────────────────────────────

describe("PgTaskQueue.claimNextPending", () => {
  it("selects one pending task, immediate-first then oldest, with the 30s grace", async () => {
    const { pool, calls } = mockPool([{ rows: [{ id: "t1", status: "pending" }] }]);
    const task = await new PgTaskQueue(pool).claimNextPending();
    expect(task).toEqual({ id: "t1", status: "pending" });
    expect(calls[0].sql).toContain("WHERE status = 'pending'");
    expect(calls[0].sql).toContain("priority = 'immediate'");
    expect(calls[0].sql).toContain("now() - interval '30 seconds'");
    expect(calls[0].sql).toContain("LIMIT 1");
  });

  it("drops the dead `status != 'running-local'` predicate", async () => {
    const { pool, calls } = mockPool([{ rows: [] }]);
    await new PgTaskQueue(pool).claimNextPending();
    expect(calls[0].sql).not.toContain("running-local");
  });

  it("returns null when nothing is runnable", async () => {
    const { pool } = mockPool([{ rows: [] }]);
    expect(await new PgTaskQueue(pool).claimNextPending()).toBeNull();
  });
});

describe("PgTaskQueue.findRecoverable", () => {
  it("filters running/queued past the minute interval", async () => {
    const { pool, calls } = mockPool([{ rows: [{ id: "t1", task_type: "general" }] }]);
    const rows = await new PgTaskQueue(pool).findRecoverable(30);
    expect(rows).toEqual([{ id: "t1", task_type: "general" }]);
    expect(calls[0].sql).toContain("status IN ('running', 'queued')");
    expect(calls[0].sql).toContain("($1 || ' minutes')::interval");
    expect(calls[0].values).toEqual(["30"]);
  });
});

describe("PgTaskQueue.claimSpecTask", () => {
  it("returns true when the CAS updates a still-pending row", async () => {
    const { pool, calls } = mockPool([{ rows: [{ id: "t1" }] }]);
    expect(await new PgTaskQueue(pool).claimSpecTask("t1")).toBe(true);
    expect(calls[0].sql).toContain("WHERE id = $1 AND status = 'pending'");
    expect(calls[0].sql).toContain("agent_id = 'spec-task-executor'");
  });

  it("returns false when the row was already claimed", async () => {
    const { pool } = mockPool([{ rows: [] }]);
    expect(await new PgTaskQueue(pool).claimSpecTask("t1")).toBe(false);
  });
});

describe("PgTaskQueue org-wide reads", () => {
  it("awaitingApproval selects approval-gated tasks carrying an issue", async () => {
    const { pool, calls } = mockPool([{ rows: [{ id: "t1", target_repo: "a/b", issue_number: 7 }] }]);
    const rows = await new PgTaskQueue(pool).awaitingApproval();
    expect(rows).toEqual([{ id: "t1", target_repo: "a/b", issue_number: 7 }]);
    expect(calls[0].sql).toContain("status = 'awaiting_approval'");
    expect(calls[0].sql).toContain("issue_number IS NOT NULL");
  });

  it("distinctTargetRepos returns the ascending non-null repo set", async () => {
    const { pool, calls } = mockPool([{ rows: [{ target_repo: "a/b" }, { target_repo: "c/d" }] }]);
    expect(await new PgTaskQueue(pool).distinctTargetRepos()).toEqual(["a/b", "c/d"]);
    expect(calls[0].sql).toContain("SELECT DISTINCT target_repo");
    expect(calls[0].sql).toContain("target_repo IS NOT NULL");
  });

  it("prInfo returns the PR coordinates for one task id", async () => {
    const { pool, calls } = mockPool([{ rows: [{ pr_number: 12, target_repo: "a/b", target_branch: "main" }] }]);
    expect(await new PgTaskQueue(pool).prInfo("t1")).toEqual({ pr_number: 12, target_repo: "a/b", target_branch: "main" });
    expect(calls[0].sql).toContain("pr_number, target_repo, target_branch");
    expect(calls[0].values).toEqual(["t1"]);
  });

  it("prInfo returns null for an unknown task", async () => {
    const { pool } = mockPool([{ rows: [] }]);
    expect(await new PgTaskQueue(pool).prInfo("nope")).toBeNull();
  });
});

// ── InMemoryTaskQueue: behavioral spec ─────────────────────────────────

const at = (now: number, deltaSec: number) => new Date(now - deltaSec * 1000).toISOString();

describe("InMemoryTaskQueue.claimNextPending", () => {
  const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);
  const queue = (tasks: SeedTask[]) => new InMemoryTaskQueue(tasks, () => NOW);

  it("picks an immediate task with no grace delay", async () => {
    const q = queue([{ id: "i", status: "pending", priority: "immediate", created_at: at(NOW, 0) }]);
    expect((await q.claimNextPending())?.id).toBe("i");
  });

  it("withholds a normal task until it is strictly older than the 30s grace", async () => {
    // The claim uses `created_at < now() - interval '30 seconds'`: a task exactly
    // 30s old is the boundary and not yet eligible; eligibility needs age > 30s.
    for (const ageSec of [29, 30]) {
      expect(
        await queue([{ id: "n", status: "pending", priority: "normal", created_at: at(NOW, ageSec) }]).claimNextPending(),
      ).toBeNull();
    }
    expect(
      (await queue([{ id: "n", status: "pending", priority: "normal", created_at: at(NOW, 31) }]).claimNextPending())?.id,
    ).toBe("n");
  });

  it("ignores non-pending tasks", async () => {
    for (const status of ["running-local", "running", "completed"]) {
      expect(
        await queue([{ id: "x", status, priority: "immediate", created_at: at(NOW, 0) }]).claimNextPending(),
      ).toBeNull();
    }
  });

  it("orders immediate before normal, then oldest first", async () => {
    const q = queue([
      { id: "normal-old", status: "pending", priority: "normal", created_at: at(NOW, 100) },
      { id: "immediate-new", status: "pending", priority: "immediate", created_at: at(NOW, 1) },
      { id: "normal-older", status: "pending", priority: "normal", created_at: at(NOW, 200) },
    ]);
    expect((await q.claimNextPending())?.id).toBe("immediate-new");
  });
});

describe("InMemoryTaskQueue sweeps", () => {
  const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);

  it("findRecoverable returns running/queued idle past the window", async () => {
    const q = new InMemoryTaskQueue(
      [
        { id: "stale", status: "running", task_type: "general", updated_at: at(NOW, 31 * 60) },
        { id: "fresh", status: "running", task_type: "general", updated_at: at(NOW, 60) },
        { id: "impl", status: "queued", task_type: "implementation", updated_at: at(NOW, 40 * 60) },
      ],
      () => NOW,
    );
    expect((await q.findRecoverable(30)).map((r) => r.id)).toEqual(["stale", "impl"]);
  });

  it("findStaleRunning returns running tasks older than the hour threshold with age", async () => {
    const q = new InMemoryTaskQueue(
      [{ id: "old", status: "running", task_type: "review", target_repo: "a/b", created_at: at(NOW, 7 * 3600), issue_number: 5 }],
      () => NOW,
    );
    const stale = await q.findStaleRunning(6);
    expect(stale).toMatchObject([{ id: "old", target_repo: "a/b", issue_number: 5 }]);
    expect(stale[0].age_hours).toBeCloseTo(7, 5);
  });
});

describe("InMemoryTaskQueue.claimSpecTask", () => {
  it("claims a pending spec-task once (CAS)", async () => {
    const q = new InMemoryTaskQueue([{ id: "s", status: "pending", task_type: "spec-task" }]);
    expect(await q.claimSpecTask("s")).toBe(true);
    expect(await q.claimSpecTask("s")).toBe(false);
  });
});

describe("InMemoryTaskQueue org-wide reads", () => {
  it("awaitingApproval returns only approval-gated tasks with an issue", async () => {
    const q = new InMemoryTaskQueue([
      { id: "a", status: "awaiting_approval", target_repo: "a/b", issue_number: 3 },
      { id: "b", status: "awaiting_approval", target_repo: "a/b", issue_number: null },
      { id: "c", status: "pending", target_repo: "a/b", issue_number: 9 },
    ]);
    expect(await q.awaitingApproval()).toEqual([{ id: "a", target_repo: "a/b", issue_number: 3 }]);
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
    expect(await q.prInfo("1")).toEqual({ pr_number: 5, target_repo: "a/b", target_branch: "main" });
    expect(await q.prInfo("missing")).toBeNull();
  });
});

describe("InMemoryTaskQueue.findReadySpecTasks", () => {
  it("returns only spec-tasks whose deps are completed/merged in the same spec", async () => {
    const q = new InMemoryTaskQueue([
      { id: "dep", status: "completed", task_type: "spec-task", target_repo: "a/b", context_bundle: { spec_task_id: "T1", spec_slug: "x" } },
      { id: "ready", status: "pending", task_type: "spec-task", target_repo: "a/b", context_bundle: { spec_task_id: "T2", spec_slug: "x", depends_on: ["T1"] } },
      { id: "blocked", status: "pending", task_type: "spec-task", target_repo: "a/b", context_bundle: { spec_task_id: "T3", spec_slug: "x", depends_on: ["T9"] } },
    ]);
    expect((await q.findReadySpecTasks()).map((t) => t.id)).toEqual(["ready"]);
  });
});
