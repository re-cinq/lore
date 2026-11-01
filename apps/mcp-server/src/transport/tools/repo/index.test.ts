import { describe, it, expect } from "vitest";
import { registerRepoTools } from "./index.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

describe("registerRepoTools", () => {
  it("registers the domain's tools in order", () => {
    expect(Object.keys(toolHandlers(registerRepoTools, "full"))).toEqual([
      "lore_list_repos",
      "lore_onboard_repo",
      "lore_ingest_files",
      "lore_next_ready_issue",
    ]);
  });
});
