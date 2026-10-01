import { describe, it, expect } from "vitest";
import { loadAgentDefaults } from "./agent-defaults-files.js";

describe("loadAgentDefaults", () => {
  it("loads the 17 shipped agents and 5 def- stations, each named after its file, and none of the deleted implementation, implementation-tdd and general", () => {
    const defaults = loadAgentDefaults();

    expect({
      count: defaults.length,
      deleted: defaults
        .map((row) => row.name)
        .filter((name) =>
          ["implementation", "implementation-tdd", "general"].includes(name),
        ),
      review: defaults.find((row) => row.name === "review")?.execution_mode,
      station: defaults.find((row) => row.name === "def-validate")
        ?.execution_mode,
    }).toEqual({
      count: 22,
      deleted: [],
      review: "claude-code",
      station: "station",
    });
  });
});
