import { describe, it, expect } from "vitest";
import { loadAgentDefaults } from "./agent-defaults-files.js";

describe("loadAgentDefaults", () => {
  it("loads the 37 shipped agents, each named after its file, and none of the deleted def- station recipes, implementation, implementation-tdd and general", () => {
    const defaults = loadAgentDefaults();

    expect({
      count: defaults.length,
      deleted: defaults
        .map((row) => row.name)
        .filter(
          (name) =>
            name.startsWith("def-") ||
            ["implementation", "implementation-tdd", "general"].includes(name),
        ),
      story: defaults.find((row) => row.name === "review-story")
        ?.execution_mode,
      review: defaults.find((row) => row.name === "code-review")
        ?.execution_mode,
    }).toEqual({
      count: 37,
      deleted: [],
      review: "claude-code",
      story: "claude-code",
    });
  });
});
