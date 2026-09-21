import { describe, it, expect } from "vitest";
import { InMemoryTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-memory.js";
import { decideTaskSettlement, settleTaskForLine } from "./settle-task.js";

const REPO = "re-cinq/lore";

function planningTask(id: string) {
  return {
    id,
    task_type: "feature-planning",
    status: "running",
    target_repo: REPO,
    description: "plan it",
    context_bundle: { plan_id: "p1" },
  };
}

describe("decideTaskSettlement", () => {
  it("returns completed for a completed line whose task is still running", () => {
    expect(
      decideTaskSettlement({ outcome: "completed", taskStatus: "running" }),
    ).toEqual({ status: "completed" });
  });

  it("returns failed carrying the line reason for a failed line", () => {
    expect(
      decideTaskSettlement({
        outcome: "failed",
        reason: 'node "analyze" failed',
        taskStatus: "running",
      }),
    ).toEqual({ status: "failed", failureReason: 'node "analyze" failed' });
  });

  it("names the outcome when a failed line recorded no reason", () => {
    expect(
      decideTaskSettlement({ outcome: "timeout", taskStatus: "queued" }),
    ).toEqual({ status: "failed", failureReason: "assembly line timeout" });
  });

  it("returns null for a task already at pr-created", () => {
    expect(
      decideTaskSettlement({ outcome: "completed", taskStatus: "pr-created" }),
    ).toBeNull();
  });

  it("returns null when the line deferred to another run holding the branch", () => {
    expect(
      decideTaskSettlement({ outcome: "lease_held", taskStatus: "running" }),
    ).toBeNull();
  });
});

describe("settleTaskForLine", () => {
  it("writes failed + failure_reason onto the running task of a failed line", async () => {
    const tasks = new InMemoryTaskStore([planningTask("t1")]);

    await settleTaskForLine(
      { id: "line-1", taskId: "t1", repo: REPO },
      "failed",
      'node "analyze" failed',
      { tasks },
    );

    expect(await tasks.getById("t1")).toMatchObject({
      status: "failed",
      failure_reason: 'node "analyze" failed',
    });
    expect(tasks.events.at(-1)).toMatchObject({
      task_id: "t1",
      from_status: "running",
      to_status: "failed",
      metadata: { assembly_run_id: "line-1", outcome: "failed" },
    });
  });

  it("completes a non-planning task whose line completed", async () => {
    const tasks = new InMemoryTaskStore([
      {
        id: "t3",
        task_type: "implementation",
        status: "running",
        target_repo: REPO,
        description: "build it",
      },
    ]);

    await settleTaskForLine(
      { id: "line-3", taskId: "t3", repo: REPO },
      "completed",
      undefined,
      { tasks },
    );

    expect(await tasks.getById("t3")).toMatchObject({ status: "completed" });
  });

  it("leaves a task-less line alone", async () => {
    const tasks = new InMemoryTaskStore([]);

    await settleTaskForLine(
      { id: "line-1", taskId: null, repo: REPO },
      "failed",
      "boom",
      { tasks },
    );

    expect(tasks.events).toEqual([]);
  });
});
