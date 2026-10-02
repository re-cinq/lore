import { describe, it, expect } from "vitest";
import { loadAgentDefaults } from "./agent-defaults-files.js";

describe("loadAgentDefaults", () => {
  it("loads the 17 shipped agents, each named after its file, and none of the deleted def- station recipes, implementation, implementation-tdd and general", () => {
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
      review: defaults.find((row) => row.name === "review")?.execution_mode,
    }).toEqual({
      count: 17,
      deleted: [],
      review: "claude-code",
    });
  });
});
