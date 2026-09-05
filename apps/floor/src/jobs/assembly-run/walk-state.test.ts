import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { taskFromAssemblyRun } from "./walk-state.js";

describe("taskFromAssemblyRun", () => {
  it("derives the synthetic taskId for a task-less row and keeps the real one otherwise", async () => {
    const port = new InMemoryAssemblyRuns();
    const taskless = await port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: { description: "d" },
    });
    const rowless = (await port.getById(taskless))!;

    expect(taskFromAssemblyRun(rowless)).toMatchObject({
      taskId: taskless,
      pipelineTaskId: null,
      assemblyLineId: taskless,
      description: "d",
    });

    const taskful = await port.start({
      blueprintName: "implementation",
      repo: "o/r",
      taskId: "task-9",
    });

    expect(taskFromAssemblyRun((await port.getById(taskful))!)).toMatchObject({
      taskId: "task-9",
      pipelineTaskId: "task-9",
    });
  });
});
