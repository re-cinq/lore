import { describe, it, expect } from "vitest";
import { modelVendor, NON_ANTHROPIC_LIKE_PATTERNS } from "./model-vendor.js";

describe("modelVendor", () => {
  it("classifies every claude model id as anthropic", () => {
    expect(modelVendor("claude-sonnet-4-6")).toBe("anthropic");
    expect(modelVendor("claude-haiku-4-5-20251001")).toBe("anthropic");
    expect(modelVendor("claude-fable-5")).toBe("anthropic");
  });

  it("classifies the gemini ids the review family actually runs as gemini", () => {
    expect(modelVendor("gemini-3.1-pro-preview")).toBe("gemini");
    expect(modelVendor("gemini-3-flash-preview")).toBe("gemini");
    expect(modelVendor("gemini-3.1-flash-lite")).toBe("gemini");
  });

  it("reads the empty non-token model as anthropic, not as unknown", () => {
    // Anthropic's cost report bills web search and code execution on a row
    // with no model; it is the Anthropic account's spend either way.
    expect(modelVendor("")).toBe("anthropic");
  });

  it("counts an unrecognized model against anthropic, the safe direction for a balance", () => {
    expect(modelVendor("some-future-model-9")).toBe("anthropic");
  });

  it("classifies openai and local-runtime ids away from anthropic", () => {
    expect(modelVendor("gpt-5")).toBe("openai");
    expect(modelVendor("o3-mini")).toBe("openai");
    expect(modelVendor("llama-3.3-70b")).toBe("local");
  });

  it("matches every non-anthropic vendor with a LIKE pattern the spend SQL can use", () => {
    // The SQL predicate and this classifier are one declaration; a vendor
    // classified away from anthropic with no pattern would be excluded by the
    // page and still charged to the balance.
    const nonAnthropic = [
      "gemini-3.1-pro-preview",
      "gpt-5",
      "o1-preview",
      "o3-mini",
      "llama-3.3-70b",
      "mistral-large",
      "qwen-2.5",
    ];

    for (const model of nonAnthropic) {
      expect(modelVendor(model)).not.toBe("anthropic");
      expect(
        NON_ANTHROPIC_LIKE_PATTERNS.some((pattern) =>
          model.startsWith(pattern.replace("%", "")),
        ),
      ).toBe(true);
    }
  });
});
