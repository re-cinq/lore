import { describe, it, expect } from "vitest";
import { repoTaskInput } from "./station-task-routes.js";

describe("repoTaskInput", () => {
  it("forwards a spec-task's group g-1 to the queue along with its description, type, author and bundle", () => {
    expect(
      repoTaskInput({
        description: "T001",
        taskType: "spec-task",
        createdBy: "issues-station",
        contextBundle: { spec_task_id: "T001" },
        taskGroupId: "g-1",
      }),
    ).toEqual({
      description: "T001",
      taskType: "spec-task",
      createdBy: "issues-station",
      contextBundle: { spec_task_id: "T001" },
      taskGroupId: "g-1",
    });
  });

  it("leaves the group out when the station sends none", () => {
    expect(
      repoTaskInput({ description: "Gap: x", taskType: "gap-fill" }),
    ).toEqual({ description: "Gap: x", taskType: "gap-fill" });
  });
});
