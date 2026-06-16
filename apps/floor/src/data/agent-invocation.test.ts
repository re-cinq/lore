import { describe, it, expect } from "vitest";
import { agentPrompt } from "./agent-invocation.js";

describe("agentPrompt", () => {
  it("substitutes {description} into the resolved agent's prompt", () => {
    expect(agentPrompt("Implement: {description}", "add health check", "FB")).toBe(
      "Implement: add health check",
    );
  });

  it("falls back to the yaml task-type template when the definition has no prompt", () => {
    expect(agentPrompt(null, "x", "yaml fallback")).toBe("yaml fallback");
    expect(agentPrompt("", "x", "yaml fallback")).toBe("yaml fallback");
  });
});
