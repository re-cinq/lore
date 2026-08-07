import { describe, it, expect } from "vitest";
import { modelFamily } from "./model-family.js";

describe("modelFamily", () => {
  it("returns anthropic for a claude sonnet model id", () => {
    expect(modelFamily("claude-sonnet-4-6")).toBe("anthropic");
  });

  it("returns anthropic for a claude haiku model id", () => {
    expect(modelFamily("claude-haiku-4-5-20251001")).toBe("anthropic");
  });

  it("returns anthropic regardless of the vendor prefix's letter case", () => {
    expect(modelFamily("Claude-Opus-4")).toBe("anthropic");
  });

  it("returns openai for a gpt model id", () => {
    expect(modelFamily("gpt-5.6")).toBe("openai");
  });

  it("returns google for a gemini model id", () => {
    expect(modelFamily("gemini-2.5-pro")).toBe("google");
  });

  it("returns unknown for an unrecognized model id", () => {
    expect(modelFamily("llama3")).toBe("unknown");
  });

  it("returns unknown for an empty model id", () => {
    expect(modelFamily("")).toBe("unknown");
  });

  it("returns unknown for an undefined model id", () => {
    expect(modelFamily(undefined)).toBe("unknown");
  });
});
