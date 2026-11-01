import { describe, it, expect } from "vitest";
import { registerCiTools } from "./index.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

describe("registerCiTools", () => {
  it("registers the domain's tools in order", () => {
    expect(Object.keys(toolHandlers(registerCiTools, "full"))).toEqual([
      "lore_get_ci_failures",
      "lore_get_ci_job_log",
      "lore_get_pr_status",
    ]);
  });
});
