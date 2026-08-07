import { describe, it, expect } from "vitest";
import { modelFamily, crossModelReviewWarning } from "./model-family.js";

describe("modelFamily — bare model ids", () => {
  it("returns anthropic for a claude sonnet model id", () => {
    expect(modelFamily("claude-sonnet-4-6")).toBe("anthropic");
  });

  it("returns anthropic for a claude haiku model id", () => {
    expect(modelFamily("claude-haiku-4-5-20251001")).toBe("anthropic");
  });

  it("returns anthropic regardless of the vendor prefix's letter case", () => {
    expect(modelFamily("Claude-Opus-4")).toBe("anthropic");
  });

  it("returns openai for a gpt-5 model id", () => {
    expect(modelFamily("gpt-5.6")).toBe("openai");
  });

  it("returns openai for a gpt-4o model id", () => {
    expect(modelFamily("gpt-4o-mini")).toBe("openai");
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

  it("returns unknown for a whitespace-only model id", () => {
    expect(modelFamily("   ")).toBe("unknown");
  });

  it("trims surrounding whitespace before classifying", () => {
    expect(modelFamily("  claude-sonnet-4-6  ")).toBe("anthropic");
  });
});

describe("modelFamily — imposter ids that must not fold into a family", () => {
  it("returns unknown for gpt-neox-20b, an EleutherAI model with a gpt- prefix", () => {
    expect(modelFamily("gpt-neox-20b")).toBe("unknown");
  });

  it("returns unknown for gpt-j-6b, an EleutherAI model with a gpt- prefix", () => {
    expect(modelFamily("gpt-j-6b")).toBe("unknown");
  });

  it("returns unknown for claude-code, an execution-mode vendor name rather than a model id", () => {
    expect(modelFamily("claude-code")).toBe("unknown");
  });
});

describe("modelFamily — vendor-prefixed id forms", () => {
  it("returns anthropic for a Bedrock model id (vendor.model)", () => {
    expect(modelFamily("anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
      "anthropic",
    );
  });

  it("returns anthropic for a region-prefixed Bedrock model id (region.vendor.model)", () => {
    expect(modelFamily("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(
      "anthropic",
    );
  });

  it("returns anthropic for an OpenRouter model id (vendor/model)", () => {
    expect(modelFamily("anthropic/claude-sonnet-4.5")).toBe("anthropic");
  });

  it("returns openai for an OpenRouter model id (vendor/model)", () => {
    expect(modelFamily("openai/gpt-5")).toBe("openai");
  });
});

describe("modelFamily — OpenAI reasoning and chat id forms", () => {
  it("returns openai for the bare o3 reasoning model id", () => {
    expect(modelFamily("o3")).toBe("openai");
  });

  it("returns openai for the o4-mini reasoning model id", () => {
    expect(modelFamily("o4-mini")).toBe("openai");
  });

  it("returns openai for the o1-preview reasoning model id", () => {
    expect(modelFamily("o1-preview")).toBe("openai");
  });

  it("returns openai for the chatgpt-4o-latest model id", () => {
    expect(modelFamily("chatgpt-4o-latest")).toBe("openai");
  });

  it("returns unknown for ollama, which merely starts with the letter o", () => {
    expect(modelFamily("ollama")).toBe("unknown");
  });
});

describe("crossModelReviewWarning", () => {
  it("warns naming both models and the shared family when implementer and reviewer are both claude", () => {
    expect(
      crossModelReviewWarning("claude-sonnet-4-6", "claude-haiku-4-5-20251001"),
    ).toBe(
      "Implementer (claude-sonnet-4-6) and reviewer (claude-haiku-4-5-20251001) both resolve to the anthropic model family; review lacks cross-model diversity.",
    );
  });

  it("warns with a sharper identity message when implementer and reviewer are the exact same model", () => {
    expect(
      crossModelReviewWarning("claude-sonnet-4-6", "claude-sonnet-4-6"),
    ).toBe(
      "Implementer and reviewer are the identical model (claude-sonnet-4-6); this is the strongest form of self-preference bias, not just same-family review.",
    );
  });

  it("returns null when implementer and reviewer resolve to different families", () => {
    expect(crossModelReviewWarning("claude-sonnet-4-6", "gpt-5.6")).toBeNull();
  });

  it("returns null when the implementer model is unrecognized", () => {
    expect(
      crossModelReviewWarning("llama3", "claude-haiku-4-5-20251001"),
    ).toBeNull();
  });

  it("returns null when the reviewer model is unrecognized", () => {
    expect(crossModelReviewWarning("claude-sonnet-4-6", "llama3")).toBeNull();
  });

  it("returns null when both models are undefined", () => {
    expect(crossModelReviewWarning(undefined, undefined)).toBeNull();
  });
});
