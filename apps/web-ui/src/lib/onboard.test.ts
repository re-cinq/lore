import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = vi.fn();

vi.mock("./db", () => ({
  withTransaction: (fn: (run: unknown) => unknown) => fn(tx),
}));

import { createOnboardTask } from "./onboard";

type Row = Record<string, unknown>;

/**
 * Answer each statement by matching its SQL rather than its call index: the
 * guard reads and the three writes all run on one `tx`, and an order-indexed
 * double mis-answers the moment a statement is added between them.
 */
function txReturning({
  repoRows = [] as Row[],
  taskRows = [] as Row[],
  taskId = "task-1",
} = {}) {
  tx.mockImplementation((sql: string) => {
    if (sql.includes("INSERT INTO pipeline.tasks")) {
      return Promise.resolve([{ id: taskId }]);
    }

    if (sql.includes("FROM lore.repos")) {
      return Promise.resolve(repoRows);
    }

    if (sql.includes("pipeline.tasks")) {
      return Promise.resolve(taskRows);
    }

    return Promise.resolve([]);
  });
}

const sqlIssued = () => tx.mock.calls.map((call) => String(call[0]));

const callMatching = (needle: string) =>
  tx.mock.calls.find((call) => String(call[0]).includes(needle));

const wrote = () =>
  sqlIssued().some((sql) => sql.trimStart().toUpperCase().startsWith("INSERT"));

// Block body, not a concise one: `mockReset()` returns the mock, and vitest
// treats a function returned from beforeEach as the teardown hook — it would
// call `tx()` with no arguments after every test.
beforeEach(() => {
  tx.mockReset();
});

describe("createOnboardTask", () => {
  it("takes the per-repo advisory lock before reading the guard state", async () => {
    txReturning();

    await createOnboardTask("re-cinq/x");

    const issued = sqlIssued();

    expect(issued[0]).toContain("pg_advisory_xact_lock");
    expect(tx.mock.calls[0][1]).toEqual(["lore.onboard:re-cinq/x"]);
    expect(
      issued.findIndex((sql) => sql.includes("FROM lore.repos")),
    ).toBeGreaterThan(0);
  });

  it("inserts the task, its pending event, and the repos row for a clear repo", async () => {
    txReturning();

    const result = await createOnboardTask("re-cinq/x");

    expect(result).toEqual({ ok: true, taskId: "task-1" });
    expect(callMatching("INSERT INTO pipeline.tasks")?.[0]).toContain(
      "'onboard'",
    );
    expect(
      (callMatching("INSERT INTO pipeline.tasks")?.[1] as string[])[1],
    ).toBe("re-cinq/x");
    expect(callMatching("pipeline.task_events")).toBeDefined();
    expect(callMatching("INSERT INTO lore.repos")).toBeDefined();
  });

  it("sends a described task instead of the bare repo name", async () => {
    txReturning();

    await createOnboardTask("re-cinq/x");

    const [description] = callMatching(
      "INSERT INTO pipeline.tasks",
    )?.[1] as string[];

    expect(description).toContain("re-cinq/x");
    expect(description).toContain("CLAUDE.md");
  });

  it("blocks already-onboarded and writes nothing", async () => {
    txReturning({
      repoRows: [{ onboarding_pr_merged: true, onboarding_pr_url: null }],
    });

    const result = await createOnboardTask("re-cinq/x");

    expect(result).toMatchObject({
      ok: false,
      block: "already-onboarded",
      taskId: null,
    });
    expect(wrote()).toBe(false);
  });

  it("blocks an ingested legacy row whose merged flag was never set", async () => {
    txReturning({
      repoRows: [{ last_ingested_at: "2026-01-01T00:00:00Z" }],
    });

    const result = await createOnboardTask("re-cinq/x");

    expect(result).toMatchObject({ ok: false, block: "already-onboarded" });
    expect(wrote()).toBe(false);
  });

  it("blocks in-flight and returns the running task id", async () => {
    txReturning({
      repoRows: [{ onboarding_pr_merged: false, onboarding_pr_url: null }],
      taskRows: [{ id: "task-running" }],
    });

    const result = await createOnboardTask("re-cinq/x");

    expect(result).toMatchObject({
      ok: false,
      block: "in-flight",
      taskId: "task-running",
    });
    expect(wrote()).toBe(false);
  });

  it("blocks in-flight even when reonboard is requested", async () => {
    txReturning({
      repoRows: [{ onboarding_pr_merged: true, onboarding_pr_url: null }],
      taskRows: [{ id: "task-running" }],
    });

    const result = await createOnboardTask("re-cinq/x", { reonboard: true });

    expect(result).toMatchObject({ ok: false, block: "in-flight" });
    expect(wrote()).toBe(false);
  });

  it("queues a task for an onboarded repo when reonboard is requested", async () => {
    txReturning({
      repoRows: [{ onboarding_pr_merged: true, onboarding_pr_url: null }],
      taskId: "task-2",
    });

    const result = await createOnboardTask("re-cinq/x", { reonboard: true });

    expect(result).toEqual({ ok: true, taskId: "task-2" });
  });

  it("blocks pr-open while the onboarding PR is unmerged", async () => {
    txReturning({
      repoRows: [
        {
          onboarding_pr_merged: false,
          onboarding_pr_url: "https://github.com/re-cinq/x/pull/7",
        },
      ],
    });

    const result = await createOnboardTask("re-cinq/x");

    expect(result).toMatchObject({
      ok: false,
      block: "pr-open",
      message: expect.stringContaining("pull/7"),
    });
  });

  it("blocks pr-open even when reonboard is requested", async () => {
    txReturning({
      repoRows: [
        {
          onboarding_pr_merged: false,
          onboarding_pr_url: "https://github.com/re-cinq/x/pull/7",
        },
      ],
    });

    const result = await createOnboardTask("re-cinq/x", { reonboard: true });

    expect(result).toMatchObject({ ok: false, block: "pr-open", taskId: null });
    expect(wrote()).toBe(false);
  });
});
