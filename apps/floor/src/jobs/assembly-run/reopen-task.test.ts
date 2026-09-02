import { describe, it, expect } from "vitest";
import type { PipelineTask } from "@re-cinq/lore-shared";
import { decideTaskReopen, reopenTaskForFork } from "./reopen-task.js";

function fakeTasks(task: Partial<PipelineTask> | null) {
  const calls = {
    setStatus: [] as Array<{
      expected: string;
      status: string;
      failure_reason?: string | null;
    }>,
    events: [] as Array<{ from: string | null; to: string | null }>,
  };

  return {
    calls,
    tasks: {
      getById: async () =>
        task
          ? ({ id: "task-9", status: "failed", ...task } as PipelineTask)
          : null,
      setStatusIf: async (
        _id: string,
        expected: string,
        status: string,
        extra?: Record<string, unknown>,
      ) => {
        calls.setStatus.push({ expected, status, ...extra });

        return true;
      },
      recordEvent: async (
        _id: string,
        from: string | null,
        to: string | null,
      ) => {
        calls.events.push({ from, to });
      },
    },
  };
}

describe("decideTaskReopen", () => {
  it("reopens a failed, cancelled, completed or needs-human-help task as running", () => {
    expect(decideTaskReopen("failed")).toBe("running");
    expect(decideTaskReopen("cancelled")).toBe("running");
    expect(decideTaskReopen("completed")).toBe("running");
    // A human retrying from the run page IS the help the task waited for.
    expect(decideTaskReopen("needs-human-help")).toBe("running");
  });

  it("leaves an already-open or merged task alone", () => {
    for (const status of [
      "pending",
      "queued",
      "running",
      "pr-created",
      "review",
      "retried",
      "merged",
    ]) {
      expect(decideTaskReopen(status)).toBeNull();
    }
  });
});

describe("reopenTaskForFork", () => {
  it("flips the failed task behind the fork back to running and records the transition", async () => {
    const { tasks, calls } = fakeTasks({ status: "failed" });

    await reopenTaskForFork({ id: "run-fork", taskId: "task-9" }, { tasks });

    expect(calls.setStatus).toEqual([
      // failure_reason cleared with the flip — a running task must not wear
      // the source attempt's failure text.
      { expected: "failed", status: "running", failure_reason: null },
    ]);
    expect(calls.events).toEqual([{ from: "failed", to: "running" }]);
  });

  it("no-ops for a task-less run and for a task already open", async () => {
    const bare = fakeTasks({ status: "running" });

    await reopenTaskForFork(
      { id: "run-fork", taskId: null },
      { tasks: bare.tasks },
    );
    await reopenTaskForFork(
      { id: "run-fork", taskId: "task-9" },
      { tasks: bare.tasks },
    );

    expect(bare.calls.setStatus).toEqual([]);
  });

  it("never throws — a reopen failure must not poison the start", async () => {
    const tasks = {
      getById: async () => {
        throw new Error("db down");
      },
      setStatusIf: async () => true,
      recordEvent: async () => {},
    };

    await expect(
      reopenTaskForFork({ id: "run-fork", taskId: "task-9" }, { tasks }),
    ).resolves.toBeUndefined();
  });
});
