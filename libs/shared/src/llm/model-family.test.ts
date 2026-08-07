import { describe, it, expect } from "vitest";
import { modelFamily, crossModelReviewWarning } from "./model-family.js";

describe("modelFamily", () => {
  it("maps model ids to their provider family", () => {
    expect(modelFamily("claude-sonnet-4-6")).toBe("anthropic");
    expect(modelFamily("claude-haiku-4-5-20251001")).toBe("anthropic");
    expect(modelFamily("gpt-5.6")).toBe("openai");
    expect(modelFamily("o4-mini")).toBe("openai");
    expect(modelFamily("gemini-2.5-pro")).toBe("google");
    expect(modelFamily("mystery-model")).toBe("unknown");
  });
});

describe("crossModelReviewWarning", () => {
  it("stays silent when implementer and reviewer resolve to different families", () => {
    expect(crossModelReviewWarning("claude-sonnet-4-6", "gpt-5.6")).toBeNull();
  });

  it("warns when implementer and reviewer resolve to the same family", () => {
    const warning = crossModelReviewWarning(
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    );

    expect(warning).toContain("same model family");
  });

  it("warns hardest when the reviewer is the exact model that authored the change", () => {
    const warning = crossModelReviewWarning(
      "claude-sonnet-4-6",
      "claude-sonnet-4-6",
    );

    expect(warning).toContain("same model");
    expect(warning).toContain("claude-sonnet-4-6");
  });

  it("stays silent when either family is unknown rather than guessing", () => {
    expect(crossModelReviewWarning("acme-model", "acme-model-2")).toBeNull();
  });
});
