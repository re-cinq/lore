import { describe, it, expect } from "vitest";
import { modelVendor } from "./model-vendor";

describe("modelVendor", () => {
  it("returns anthropic, google, openai and unknown for claude-sonnet-4-6, gemini-4-argon, gpt-5 and llama-4", () => {
    expect(
      ["claude-sonnet-4-6", "gemini-4-argon", "gpt-5", "llama-4"].map(
        modelVendor,
      ),
    ).toEqual(["anthropic", "google", "openai", "unknown"]);
  });

  it("returns openai for o3-mini, o4-mini and codex-mini", () => {
    expect(["o3-mini", "o4-mini", "codex-mini"].map(modelVendor)).toEqual([
      "openai",
      "openai",
      "openai",
    ]);
  });

  it("returns unknown when the model is inherited", () => {
    expect(modelVendor(null)).toBe("unknown");
  });
});
