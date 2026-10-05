import { describe, it, expect } from "vitest";
import { loadAgentDefaults } from "@re-cinq/lore-shared/project/agents/agent-defaults-files.js";

describe("triage-reproduce recipe (specs/issue-triage/spec.md#FR12)", () => {
  it("triage-reproduce has timeout_minutes 15 and documents all four LORE_NODE_RESULT outcomes", () => {
    const def = loadAgentDefaults().find((d) => d.name === "triage-reproduce");
    const prompt = def?.prompt ?? "";

    expect({
      timeout: def?.timeout_minutes,
      hasPrompt: prompt.length > 0,
      success: prompt.includes("LORE_NODE_RESULT: success"),
      unableToReproduce: prompt.includes(
        "LORE_NODE_RESULT: unable-to-reproduce",
      ),
      needsReproduction: prompt.includes(
        "LORE_NODE_RESULT: needs-reproduction",
      ),
      skipped: prompt.includes("LORE_NODE_RESULT: skipped"),
    }).toEqual({
      timeout: 15,
      hasPrompt: true,
      success: true,
      unableToReproduce: true,
      needsReproduction: true,
      skipped: true,
    });
  });
});
