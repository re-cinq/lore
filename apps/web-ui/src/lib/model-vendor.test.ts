import { describe, it, expect } from "vitest";
import { modelVendor } from "./model-vendor";

describe("modelVendor", () => {
  it("returns anthropic, google and unknown for claude-sonnet-4-6, gemini-4-argon and gpt-5", () => {
    expect(
      ["claude-sonnet-4-6", "gemini-4-argon", "gpt-5"].map(modelVendor),
    ).toEqual(["anthropic", "google", "unknown"]);
  });

  it("returns unknown when the model is inherited", () => {
    expect(modelVendor(null)).toBe("unknown");
  });
});
