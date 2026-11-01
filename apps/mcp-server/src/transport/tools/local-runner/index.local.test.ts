import { describe, it, expect } from "vitest";
import { registerLocalRunnerTools } from "./index.local.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

describe("registerLocalRunnerTools", () => {
  it("registers the domain's tools in order", () => {
    expect(Object.keys(toolHandlers(registerLocalRunnerTools, "full"))).toEqual(
      [
        "lore_run_task_locally",
        "lore_list_local_tasks",
        "lore_cancel_local_task",
        "lore_claim_and_run_locally",
        "lore_configure_local_runner",
      ],
    );
  });
});
