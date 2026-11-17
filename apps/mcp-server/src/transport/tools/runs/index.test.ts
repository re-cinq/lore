import { describe, it, expect } from "vitest";
import { registerRunTools } from "./index.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

describe("registerRunTools", () => {
  it("registers the domain's tools in order", () => {
    expect(Object.keys(toolHandlers(registerRunTools, "agent"))).toEqual([
      "lore_list_runs",
      "lore_get_run",
      "lore_get_run_node_logs",
      "lore_get_run_transcript",
      "lore_get_run_assets",
      "lore_get_run_blob",
    ]);
  });
});
