import { describe, it, expect } from "vitest";
import {
  applySupervisorOutcome,
  type ApplyOutcomeDeps,
} from "./apply-supervisor-outcome.js";

function fakeDeps() {
  const statuses: Array<{
    taskId: string;
    status: string;
    extra?: Record<string, unknown>;
  }> = [];
  const events: Array<{
    taskId: string;
    from: string | null;
    to: string | null;
    meta?: unknown;
  }> = [];
  const deps: ApplyOutcomeDeps = {
    setStatus: async (taskId, status, extra) => {
      statuses.push({ taskId, status, extra });
    },
    insertEvent: async (taskId, from, to, meta) => {
      events.push({ taskId, from, to, meta });
    },
  };

  return { deps, statuses, events };
}

describe("applySupervisorOutcome", () => {
  it("outcome error fails the task with the failure reason", async () => {
    const { deps, statuses, events } = fakeDeps();

    await applySupervisorOutcome(
      "t-1",
      { outcome: "error", errorMessage: "clone exploded" },
      deps,
    );

    expect(statuses).toEqual([
      {
        taskId: "t-1",
        status: "failed",
        extra: { failure_reason: "clone exploded" },
      },
    ]);
    expect(events).toEqual([
      {
        taskId: "t-1",
        from: "running",
        to: "failed",
        meta: { error: "clone exploded" },
      },
    ]);
  });

  it("outcome no_changes completes the task", async () => {
    const { deps, statuses, events } = fakeDeps();

    await applySupervisorOutcome("t-1", { outcome: "no_changes" }, deps);

    expect(statuses).toEqual([
      { taskId: "t-1", status: "completed", extra: undefined },
    ]);
    expect(events).toEqual([
      {
        taskId: "t-1",
        from: "running",
        to: "completed",
        meta: { reason: "no_changes" },
      },
    ]);
  });

  it("outcome pr_created records the pr event without touching status", async () => {
    const { deps, statuses, events } = fakeDeps();

    await applySupervisorOutcome(
      "t-1",
      { outcome: "pr_created", prUrl: "https://pr/7", prNumber: 7 },
      deps,
    );

    expect(statuses).toEqual([]);
    expect(events).toEqual([
      {
        taskId: "t-1",
        from: "running",
        to: "pr-created",
        meta: {
          pr_url: "https://pr/7",
          pr_number: 7,
          via: "dark-factory-supervisor",
        },
      },
    ]);
  });

  it("outcome lease_held requeues the task under the derived agent id", async () => {
    const { deps, statuses } = fakeDeps();

    await applySupervisorOutcome(
      "abcdef1234567890",
      { outcome: "lease_held" },
      deps,
    );

    expect(statuses).toEqual([
      {
        taskId: "abcdef1234567890",
        status: "queued",
        extra: { agent_id: "lore-agent-abcdef12" },
      },
    ]);
  });

  it("outcome iteration_max fails the task with the iteration reason", async () => {
    const { deps, statuses, events } = fakeDeps();

    await applySupervisorOutcome(
      "t-1",
      { outcome: "iteration_max", errorMessage: "max=2" },
      deps,
    );

    expect(statuses).toEqual([
      { taskId: "t-1", status: "failed", extra: { failure_reason: "max=2" } },
    ]);
    expect(events).toEqual([
      {
        taskId: "t-1",
        from: "running",
        to: "failed",
        meta: { reason: "iteration_max_exceeded" },
      },
    ]);
  });
});
