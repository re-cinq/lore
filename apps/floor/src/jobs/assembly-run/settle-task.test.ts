import { describe, it, expect } from "vitest";
import { InMemoryTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-memory.js";
import { InMemoryFeatures } from "@re-cinq/lore-shared/project/features/features-memory.js";
import { Features } from "@re-cinq/lore-shared/project/features/features.js";
import { decideTaskSettlement, settleTaskForLine } from "./settle-task.js";

const REPO = "re-cinq/lore";

function planningTask(id: string, iteration: number, featureId: string) {
  return {
    id,
    task_type: "feature-planning",
    status: "running",
    target_repo: REPO,
    description: "plan it",
    context_bundle: { feature_id: featureId, iteration },
  };
}

async function featureWithRunningRound(): Promise<{
  features: Features;
  featureId: string;
}> {
  const port = new InMemoryFeatures();
  const features = new Features(REPO, port);
  const feature = await features.create({
    title: "Assembly lines live view",
    prompt: "a live view over the AssemblyLines",
  });

  await features.appendIteration(feature.id, null);

  return { features, featureId: feature.id };
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
    const { features, featureId } = await featureWithRunningRound();
    const tasks = new InMemoryTaskStore([planningTask("t1", 1, featureId)]);

    await settleTaskForLine(
      { id: "line-1", taskId: "t1", repo: REPO },
      "failed",
      'node "analyze" failed',
      { tasks, featuresFor: async () => ({ features }) },
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

  it("marks the planning round failed and reverts the feature to draft when the line failed", async () => {
    const { features, featureId } = await featureWithRunningRound();
    const tasks = new InMemoryTaskStore([planningTask("t1", 1, featureId)]);

    await settleTaskForLine(
      { id: "line-1", taskId: "t1", repo: REPO },
      "failed",
      'node "analyze" failed',
      { tasks, featuresFor: async () => ({ features }) },
    );

    const feature = await features.get(featureId);

    expect(feature?.status).toBe("draft");
    expect(feature?.iterations[0]).toMatchObject({
      iteration: 1,
      status: "failed",
      gap_result: null,
    });
  });

  it("fails the round AND the task when the line completed but the pod posted no result", async () => {
    const { features, featureId } = await featureWithRunningRound();
    const tasks = new InMemoryTaskStore([planningTask("t1", 1, featureId)]);

    await settleTaskForLine(
      { id: "line-1", taskId: "t1", repo: REPO },
      "completed",
      undefined,
      { tasks, featuresFor: async () => ({ features }) },
    );

    const feature = await features.get(featureId);

    expect(feature?.iterations[0]).toMatchObject({ status: "failed" });
    expect(await tasks.getById("t1")).toMatchObject({
      status: "failed",
      failure_reason:
        "The planning run finished but posted no result — the agent did not produce a result.json the container could POST.",
    });
  });

  it("completes a non-planning task whose line completed", async () => {
    const { features } = await featureWithRunningRound();
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
      { tasks, featuresFor: async () => ({ features }) },
    );

    expect(await tasks.getById("t3")).toMatchObject({ status: "completed" });
  });

  it("leaves a round that posted its result alone", async () => {
    const { features, featureId } = await featureWithRunningRound();
    const gap = { summary: "all good", questions: [], risks: [] };

    await features.setIterationResult(featureId, 1, gap as never, "ready");
    const tasks = new InMemoryTaskStore([planningTask("t1", 1, featureId)]);

    await settleTaskForLine(
      { id: "line-1", taskId: "t1", repo: REPO },
      "completed",
      undefined,
      { tasks, featuresFor: async () => ({ features }) },
    );

    expect((await features.get(featureId))?.iterations[0]).toMatchObject({
      status: "ready",
    });
  });

  it("leaves a task-less line alone", async () => {
    const { features } = await featureWithRunningRound();
    const tasks = new InMemoryTaskStore([]);

    await settleTaskForLine(
      { id: "line-1", taskId: null, repo: REPO },
      "failed",
      "boom",
      { tasks, featuresFor: async () => ({ features }) },
    );

    expect(tasks.events).toEqual([]);
  });

  it("leaves a non-planning task's feature rows untouched", async () => {
    const { features, featureId } = await featureWithRunningRound();
    const tasks = new InMemoryTaskStore([
      {
        id: "t2",
        task_type: "implementation",
        status: "running",
        target_repo: REPO,
        description: "implement it",
      },
    ]);

    await settleTaskForLine(
      { id: "line-2", taskId: "t2", repo: REPO },
      "failed",
      'node "implement" failed',
      { tasks, featuresFor: async () => ({ features }) },
    );

    expect(await tasks.getById("t2")).toMatchObject({ status: "failed" });
    expect((await features.get(featureId))?.iterations[0]).toMatchObject({
      status: "running",
    });
  });
});
