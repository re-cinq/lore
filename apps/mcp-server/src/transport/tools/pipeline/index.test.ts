import { describe, it, expect } from "vitest";
import { registerPipelineTools } from "./index.js";

const registered: string[] = [];

registerPipelineTools({
  tool(name: string) {
    registered.push(name);
  },
} as never);

describe("registerPipelineTools", () => {
  it("registers the eleven pipeline tools in their fixed order", () => {
    expect(registered).toEqual([
      "lore_get_pipeline_status",
      "lore_list_pipeline_tasks",
      "lore_cancel_task",
      "lore_retry_task",
      "lore_list_task_group",
      "lore_get_task_logs",
      "lore_get_job_logs",
      "lore_list_pending_tasks",
      "lore_skip_task",
      "lore_enable_task_notifications",
      "lore_disable_task_notifications",
    ]);
  });

  it("registers no lore_create_pipeline_task tool, since the API creates no typed task", () => {
    expect(registered).not.toContain("lore_create_pipeline_task");
  });

  it("registers no spec-task tool, since a plan's tasks are implemented from the backlog", () => {
    const gone = [
      "lore_sync_tasks",
      "lore_ready_tasks",
      "lore_claim_task",
      "lore_complete_task",
    ];

    expect(registered.filter((name) => gone.includes(name))).toEqual([]);
  });
});
