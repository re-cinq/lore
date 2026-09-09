import { describe, it, expect } from "vitest";
import { planningTaskArgs, startFeaturePlanning } from "./start-planning.js";
import type { StartPlanningDeps } from "./start-planning.js";

function deps(
  over: Partial<StartPlanningDeps> = {},
): StartPlanningDeps & { order: string[] } {
  const order: string[] = [];

  return {
    order,
    createFeature: async () => {
      order.push("create");

      return { id: "f-1" };
    },
    appendIteration: async () => {
      order.push("append");

      return { iteration: 1 };
    },
    createPlanningTask: async () => {
      order.push("kick");

      return "task-1";
    },
    attachIterationTask: async () => {
      order.push("attach");
    },
    ...over,
  };
}

describe("planningTaskArgs", () => {
  it("always carries the feature and the iteration the round belongs to", () => {
    expect(planningTaskArgs({ featureId: "f-1", iteration: 2 })).toEqual({
      feature_id: "f-1",
      iteration: 2,
    });
  });

  it("omits round_feedback and resume_from_task when there are none", () => {
    const args = planningTaskArgs({ featureId: "f-1", iteration: 1 });

    expect("round_feedback" in args).toBe(false);
    expect("resume_from_task" in args).toBe(false);
  });

  it("carries both when a round resumes an earlier one, since only the Floor decides at dispatch whether to resume", () => {
    expect(
      planningTaskArgs({
        featureId: "f-1",
        iteration: 3,
        roundFeedback: "answer the open question",
        resumeFromTask: "task-9",
      }),
    ).toEqual({
      feature_id: "f-1",
      iteration: 3,
      round_feedback: "answer the open question",
      resume_from_task: "task-9",
    });
  });
});

describe("startFeaturePlanning", () => {
  it("appends the round BEFORE kicking it, so the task names an iteration that exists", async () => {
    const d = deps();

    await startFeaturePlanning(
      { repo: "o/r", title: "A feature", prompt: "make it good" },
      d,
    );

    expect(d.order).toEqual(["create", "append", "kick", "attach"]);
  });

  it("returns the feature and its task, which is what the route answers with", async () => {
    expect(
      await startFeaturePlanning(
        { repo: "o/r", title: "A feature", prompt: "make it good" },
        deps(),
      ),
    ).toEqual({ featureId: "f-1", taskId: "task-1", iteration: 1 });
  });

  it("attaches nothing when the kick fails, leaving no iteration pointing at a task that does not exist", async () => {
    const d = deps({
      createPlanningTask: async () => {
        throw new Error("queue is down");
      },
    });

    await expect(
      startFeaturePlanning(
        { repo: "o/r", title: "A feature", prompt: "make it good" },
        d,
      ),
    ).rejects.toThrow(/queue is down/);
    expect(d.order).toEqual(["create", "append"]);
  });
});
