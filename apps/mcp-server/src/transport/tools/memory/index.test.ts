import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerMemoryTools } from "./index.js";

describe("registerMemoryTools", () => {
  it("registers the five memory tools, then the graph and episode tools, in that order", () => {
    expect(Object.keys(toolHandlers(registerMemoryTools, "full"))).toEqual([
      "lore_write_memory",
      "lore_read_memory",
      "lore_delete_memory",
      "lore_list_memories",
      "lore_search_memory",
      "lore_write_episode",
      "lore_query_graph",
      "lore_agent_stats",
    ]);
  });
});
