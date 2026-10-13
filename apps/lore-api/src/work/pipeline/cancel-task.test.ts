import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { cancelTaskAndItsRuns } from "./cancel-task.js";

async function runFor(runs: InMemoryAssemblyRuns, taskId: string) {
  const id = await runs.start({
    blueprintName: "feature-planning",
    repo: "re-cinq/lore",
    branch: "plan/p1",
    taskId,
    args: { plan_id: "p1", pr_number: 2221 },
  });

  await runs.markRunning(id);

  return id;
}

describe("cancelTaskAndItsRuns", () => {
  it("cancels task t1 and ends its open run as cancelled, leaving task t2's run running", async () => {
    const runs = new InMemoryAssemblyRuns();
    const mine = await runFor(runs, "t1");
    const other = await runFor(runs, "t2");
    const cancelled: string[] = [];

    const result = await cancelTaskAndItsRuns("t1", {
      cancelTask: async (taskId) => {
        cancelled.push(taskId);

        return { task_id: taskId, status: "cancelled" };
      },
      runs,
    });

    expect({
      result,
      cancelled,
      mine: await runs.getById(mine),
      other: (await runs.getById(other))?.status,
    }).toMatchObject({
      result: { task_id: "t1", status: "cancelled" },
      cancelled: ["t1"],
      mine: {
        status: "finished",
        outcome: "cancelled",
        reason: "task t1 cancelled",
      },
      other: "running",
    });
  });

  it("ends no run when the task itself cannot be cancelled", async () => {
    const runs = new InMemoryAssemblyRuns();
    const mine = await runFor(runs, "t1");

    await expect(
      cancelTaskAndItsRuns("t1", {
        cancelTask: async () => {
          throw new Error("Cannot cancel task in merged state");
        },
        runs,
      }),
    ).rejects.toThrow(new Error("Cannot cancel task in merged state"));
    expect((await runs.getById(mine))?.status).toBe("running");
  });
});
