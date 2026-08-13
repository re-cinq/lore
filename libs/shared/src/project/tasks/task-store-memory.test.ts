import { describe, it, expect } from "vitest";
import { InMemoryTaskStore, type SeedStoreTask } from "./task-store-memory.js";

const tick = (start: number) => {
  let t = start;

  return () => new Date((t += 1000));
};

const T0 = Date.UTC(2026, 7, 4, 12, 0, 0);

const at = (deltaSec: number) => new Date(T0 + deltaSec * 1000).toISOString();

describe("InMemoryTaskStore status views", () => {
  const seed: SeedStoreTask[] = [
    { id: "p1", target_repo: "a/b", status: "pending", created_at: at(1) },
    {
      id: "p2",
      target_repo: "a/b",
      status: "awaiting_approval",
      created_at: at(2),
    },
    {
      id: "r1",
      target_repo: "a/b",
      status: "running-local",
      created_at: at(3),
    },
    { id: "e1", target_repo: "a/b", status: "merged", created_at: at(4) },
    {
      id: "x1",
      target_repo: "other/repo",
      status: "pending",
      created_at: at(5),
    },
  ];

  it("pending, running and executed group the status union per repo, newest first", async () => {
    const store = new InMemoryTaskStore(seed);

    expect((await store.pending("a/b")).map((t) => t.id)).toEqual(["p2", "p1"]);
    expect((await store.running("a/b")).map((t) => t.id)).toEqual(["r1"]);
    expect((await store.executed("a/b")).map((t) => t.id)).toEqual(["e1"]);
  });
});

describe("InMemoryTaskStore.create", () => {
  it("inserts a pending task with resolved priority and records the creation event", async () => {
    const store = new InMemoryTaskStore([], { now: tick(T0) });
    const created = await store.create({
      description: "do the thing",
      targetRepo: "a/b",
      priority: "whatever",
    });

    expect(created).toMatchObject({
      task_type: "general",
      status: "pending",
      priority: "normal",
    });
    expect(store.events[0]).toMatchObject({
      task_id: created.task_id,
      from_status: null,
      to_status: "pending",
      metadata: { created_by: "ui", priority: "normal" },
    });
  });

  it("applies the trust gate for a seeded repo and skips it for an unknown repo", async () => {
    const store = new InMemoryTaskStore([], {
      repoSettings: { "a/b": { trust: { level: "docs" } } },
    });

    await expect(
      store.create({
        description: "impl",
        taskType: "implementation",
        targetRepo: "a/b",
      }),
    ).rejects.toThrow(/not allowed at trust level "docs"/);
    await expect(
      store.create({
        description: "impl",
        taskType: "implementation",
        targetRepo: "unseeded/repo",
      }),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("rejects a description longer than 10000 chars", async () => {
    const store = new InMemoryTaskStore();

    await expect(
      store.create({ description: "x".repeat(10001) }),
    ).rejects.toThrow(new Error("Description too long (max 10000 chars)"));
  });
});

describe("InMemoryTaskStore.retry", () => {
  it("retries a failed task: new pending copy with retry_of, old task marked retried", async () => {
    const store = new InMemoryTaskStore(
      [
        {
          id: "t1",
          description: "broken run",
          task_type: "general",
          status: "failed",
          target_repo: "a/b",
          created_by: "ui",
          context_bundle: { spec_path: "specs/x/spec.md" },
        },
      ],
      { now: tick(T0) },
    );
    const retried = await store.retry("t1");

    expect(retried).toMatchObject({ status: "pending", retry_of: "t1" });
    expect(await store.getById("t1")).toMatchObject({ status: "retried" });
    expect(await store.getById(retried.task_id)).toMatchObject({
      created_by: "retry:ui",
      context_bundle: { spec_path: "specs/x/spec.md", retry_of: "t1" },
    });
  });

  it("refuses to retry a task that is not failed or needs-human-help", async () => {
    const store = new InMemoryTaskStore([{ id: "t1", status: "running" }]);

    await expect(store.retry("t1")).rejects.toThrow(
      new Error(
        "Cannot retry task in running state (must be failed or needs-human-help)",
      ),
    );
  });
});

describe("InMemoryTaskStore status writes", () => {
  it("setStatus writes allowlisted extras and silently skips unknown keys", async () => {
    const seed: SeedStoreTask[] = [{ id: "t1", status: "running" }];
    const store = new InMemoryTaskStore(seed, { now: tick(T0) });

    await store.setStatus("t1", "failed", {
      failure_reason: "boom",
      not_a_column: "ignored",
    });
    expect(seed[0]).toMatchObject({ status: "failed", failure_reason: "boom" });
    expect(seed[0]).not.toHaveProperty("not_a_column");
  });

  it("setStatusIf flips only from the expected status and reports who won", async () => {
    const store = new InMemoryTaskStore([{ id: "t1", status: "pending" }]);

    expect(await store.setStatusIf("t1", "running", "failed")).toBe(false);
    expect(await store.setStatusIf("t1", "pending", "running")).toBe(true);
    expect(await store.getById("t1")).toMatchObject({ status: "running" });
  });

  it("updateStatus records the old-to-new transition event", async () => {
    const store = new InMemoryTaskStore([{ id: "t1", status: "running" }], {
      now: tick(T0),
    });

    await store.updateStatus("t1", "completed", { reason: "done" });
    expect(store.events[0]).toMatchObject({
      task_id: "t1",
      from_status: "running",
      to_status: "completed",
      metadata: { reason: "done" },
    });
  });

  it("cancel refuses terminal states, markMerged requires pr-created or review", async () => {
    const store = new InMemoryTaskStore(
      [
        { id: "done", status: "merged" },
        { id: "open", status: "pr-created" },
      ],
      { now: tick(T0) },
    );

    await expect(store.cancel("done")).rejects.toThrow(
      new Error("Cannot cancel task in merged state"),
    );
    await expect(store.markMerged("done")).rejects.toThrow(
      new Error(
        "Cannot mark task as merged from merged state (expected pr-created or review)",
      ),
    );
    expect(await store.markMerged("open")).toEqual({
      task_id: "open",
      status: "merged",
    });
  });

  it("transition claim sets claimed_by and later transitions keep it (COALESCE)", async () => {
    const seed: SeedStoreTask[] = [{ id: "t1", status: "pending" }];
    const store = new InMemoryTaskStore(seed, { now: tick(T0) });

    await store.transition("t1", "claim", { agentId: "local-runner" });
    expect(seed[0]).toMatchObject({
      status: "running-local",
      claimed_by: "local-runner",
    });
    await store.transition("t1", "cancel");
    expect(seed[0]).toMatchObject({
      status: "cancelled",
      claimed_by: "local-runner",
    });
  });
});

describe("InMemoryTaskStore dedup reads", () => {
  it("findOpenLike matches type, statuses, and the description prefix — % stays a wildcard", async () => {
    const seed: SeedStoreTask[] = [
      {
        id: "t1",
        target_repo: "a/b",
        task_type: "gap-fill",
        status: "pending",
        description: "Fill gap: auth docs",
      },
      {
        id: "t2",
        target_repo: "a/b",
        task_type: "gap-fill",
        status: "merged",
        description: "Fill gap: auth docs",
      },
      {
        id: "t3",
        target_repo: "a/b",
        task_type: "gap-fill",
        status: "pending",
        description: "Other work",
      },
    ];
    const store = new InMemoryTaskStore(seed);

    expect(
      (
        await store.findOpenLike({
          repo: "a/b",
          taskType: "gap-fill",
          descriptionPrefix: "Fill gap:",
          statuses: ["pending", "running"],
        })
      ).map((t) => t.id),
    ).toEqual(["t1"]);
    expect(
      (
        await store.findOpenLike({
          repo: "a/b",
          taskType: "gap-fill",
          descriptionPrefix: "Fill%docs",
          statuses: ["pending"],
        })
      ).map((t) => t.id),
    ).toEqual(["t1"]);
  });

  it("driftTasksForSpec keys on the context bundle's spec_path", async () => {
    const store = new InMemoryTaskStore([
      {
        id: "t1",
        target_repo: "a/b",
        task_type: "spec-drift",
        status: "pending",
        created_at: at(1),
        issue_number: 7,
        context_bundle: { spec_path: "specs/x/spec.md" },
      },
      {
        id: "t2",
        target_repo: "a/b",
        task_type: "spec-drift",
        status: "pending",
        context_bundle: { spec_path: "specs/other/spec.md" },
      },
      {
        id: "t3",
        target_repo: "a/b",
        task_type: "spec-drift",
        status: "pending",
        context_bundle: null,
      },
    ]);

    expect(
      await store.driftTasksForSpec("a/b", "spec-drift", "specs/x/spec.md"),
    ).toEqual([{ status: "pending", created_at: at(1), issue_number: 7 }]);
  });
});

describe("InMemoryTaskStore list + events", () => {
  it("list filters by status, pages by limit, and reports the unpaged total", async () => {
    const seed: SeedStoreTask[] = [
      { id: "t1", status: "pending", created_at: at(1) },
      { id: "t2", status: "pending", created_at: at(2) },
      { id: "t3", status: "failed", created_at: at(3) },
    ];
    const store = new InMemoryTaskStore(seed);
    const page = await store.list("pending", 1);

    expect(page.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(page.total).toBe(2);
    expect((await store.list()).total).toBe(3);
  });

  it("getWithEvents returns the task with its events oldest-first, null when absent", async () => {
    const store = new InMemoryTaskStore([{ id: "t1", status: "running" }], {
      now: tick(T0),
    });

    await store.recordEvent("t1", null, "pending");
    await store.recordEvent("t1", "pending", "running");
    const loaded = await store.getWithEvents("t1");

    expect(loaded?.events).toHaveLength(2);
    expect(loaded?.events[0]).toMatchObject({ to_status: "pending" });
    expect(await store.getWithEvents("missing")).toBeNull();
  });
});

describe("InMemoryTaskStore.transition no-match", () => {
  it("returns undefined for an unknown id, mirroring the Pg rows[0] on a no-match UPDATE", async () => {
    const store = new InMemoryTaskStore([]);

    expect(await store.transition("missing", "claim")).toBeUndefined();
  });
});
