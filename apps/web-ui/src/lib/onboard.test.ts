import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = vi.fn();

vi.mock("./db", () => ({
  withTransaction: (fn: (run: unknown) => unknown) => fn(tx),
}));

import { createOnboardTask } from "./onboard";

/**
 * Queue the rows each guard read returns, in order: the advisory lock, the
 * lore.repos lookup, then the in-flight onboard-task lookup.
 */
function guardReads(
  repoRows: Record<string, unknown>[],
  taskRows: Record<string, unknown>[],
) {
  tx.mockResolvedValueOnce([])
    .mockResolvedValueOnce(repoRows)
    .mockResolvedValueOnce(taskRows);
}

const sqlOf = (call: number) => String(tx.mock.calls[call][0]);

beforeEach(() => tx.mockReset());

describe("createOnboardTask", () => {
  it("takes the per-repo advisory lock before reading the guard state", async () => {
    guardReads([], []);
    tx.mockResolvedValueOnce([{ id: "task-1" }]).mockResolvedValue([]);

    await createOnboardTask("re-cinq/x");

    expect(sqlOf(0)).toContain("pg_advisory_xact_lock");
    expect(tx.mock.calls[0][1]).toEqual(["lore.onboard:re-cinq/x"]);
  });

  it("inserts the task, its pending event, and the repos row for a clear repo", async () => {
    guardReads([], []);
    tx.mockResolvedValueOnce([{ id: "task-1" }]).mockResolvedValue([]);

    const result = await createOnboardTask("re-cinq/x");

    expect(result).toEqual({ ok: true, taskId: "task-1" });
    expect(sqlOf(3)).toContain("'onboard'");
    expect((tx.mock.calls[3][1] as string[])[1]).toBe("re-cinq/x");
    expect(sqlOf(4)).toContain("pipeline.task_events");
    expect(sqlOf(5)).toContain("lore.repos");
  });

  it("sends a described task instead of the bare repo name", async () => {
    guardReads([], []);
    tx.mockResolvedValueOnce([{ id: "task-1" }]).mockResolvedValue([]);

    await createOnboardTask("re-cinq/x");

    const [description] = tx.mock.calls[3][1] as string[];

    expect(description).toContain("re-cinq/x");
    expect(description).toContain("CLAUDE.md");
  });

  it("blocks already-onboarded and writes nothing", async () => {
    guardReads([{ onboarding_pr_merged: true, onboarding_pr_url: null }], []);

    const result = await createOnboardTask("re-cinq/x");

    expect(result).toMatchObject({
      ok: false,
      block: "already-onboarded",
      taskId: null,
    });
    expect(tx).toHaveBeenCalledTimes(3);
  });

  it("blocks in-flight and returns the running task id", async () => {
    guardReads(
      [{ onboarding_pr_merged: false, onboarding_pr_url: null }],
      [{ id: "task-running" }],
    );

    const result = await createOnboardTask("re-cinq/x");

    expect(result).toMatchObject({
      ok: false,
      block: "in-flight",
      taskId: "task-running",
    });
    expect(tx).toHaveBeenCalledTimes(3);
  });

  it("blocks in-flight even when reonboard is requested", async () => {
    guardReads(
      [{ onboarding_pr_merged: true, onboarding_pr_url: null }],
      [{ id: "task-running" }],
    );

    const result = await createOnboardTask("re-cinq/x", { reonboard: true });

    expect(result).toMatchObject({ ok: false, block: "in-flight" });
  });

  it("queues a task for an onboarded repo when reonboard is requested", async () => {
    guardReads([{ onboarding_pr_merged: true, onboarding_pr_url: null }], []);
    tx.mockResolvedValueOnce([{ id: "task-2" }]).mockResolvedValue([]);

    const result = await createOnboardTask("re-cinq/x", { reonboard: true });

    expect(result).toEqual({ ok: true, taskId: "task-2" });
  });

  it("blocks pr-open while the onboarding PR is unmerged", async () => {
    guardReads(
      [
        {
          onboarding_pr_merged: false,
          onboarding_pr_url: "https://github.com/re-cinq/x/pull/7",
        },
      ],
      [],
    );

    const result = await createOnboardTask("re-cinq/x");

    expect(result).toMatchObject({
      ok: false,
      block: "pr-open",
      message: expect.stringContaining("pull/7"),
    });
  });
});
