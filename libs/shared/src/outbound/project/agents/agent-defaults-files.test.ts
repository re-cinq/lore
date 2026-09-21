import { describe, it, expect } from "vitest";
import { loadAgentDefaults } from "./agent-defaults-files.js";

describe("loadAgentDefaults", () => {
  it("loads the 21 shipped agents and 5 def- stations, each named after its file", () => {
    const defaults = loadAgentDefaults();

    expect({
      count: defaults.length,
      review: defaults.find((row) => row.name === "review")?.execution_mode,
      station: defaults.find((row) => row.name === "def-validate")
        ?.execution_mode,
    }).toEqual({ count: 26, review: "claude-code", station: "station" });
  });
});
