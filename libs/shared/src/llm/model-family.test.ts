import { describe, it, expect } from "vitest";
import { modelFamily, crossModelReviewWarning } from "./model-family.js";

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

describe("crossModelReviewWarning", () => {
  it("warns naming both models and the shared family when implementer and reviewer are both claude", () => {
    const warning = crossModelReviewWarning(
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    );

    expect(warning).toMatch(/claude-sonnet-4-6/);
    expect(warning).toMatch(/claude-haiku-4-5-20251001/);
    expect(warning).toMatch(/anthropic/);
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

describe("package exports", () => {
  it("exports modelFamily and crossModelReviewWarning from the package index", async () => {
    const pkg = await import("../index.js");

    expect(pkg.modelFamily).toBe(modelFamily);
    expect(pkg.crossModelReviewWarning).toBe(crossModelReviewWarning);
  });
});
