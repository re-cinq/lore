import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerGraphEpisodeTools } from "./index.js";

describe("registerGraphEpisodeTools", () => {
  it("registers lore_write_episode, lore_query_graph and lore_agent_stats in that order", () => {
    expect(
      Object.keys(toolHandlers(registerGraphEpisodeTools, "full")),
    ).toEqual(["lore_write_episode", "lore_query_graph", "lore_agent_stats"]);
  });
});
