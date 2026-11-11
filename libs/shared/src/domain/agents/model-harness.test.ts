import { describe, it, expect } from "vitest";
import { harnessOfModel } from "./model-harness.js";

describe("harnessOfModel", () => {
  it.each([
    ["claude-sonnet-4-6", "claude"],
    ["gemini-4-argon", "gemini"],
    ["gpt-5-codex", "codex"],
    ["codex-mini", "codex"],
    ["o3", "codex"],
    ["o1-preview", "codex"],
    ["gpt-5", "codex"],
    ["opencode/anthropic/claude-sonnet-4-6", "opencode"],
    ["  Gemini-4-Argon ", "gemini"],
    ["", "claude"],
  ])("maps %j to %s", (model, harness) => {
    expect(harnessOfModel(model)).toBe(harness);
  });
});
