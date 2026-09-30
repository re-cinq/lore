import { describe, expect, it } from "vitest";
import type { RunView } from "@re-cinq/floor-client";
import { brokenReviewCheck, reviewBroke, startValueOf } from "./run-settled.js";

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    lineId: "code-review",
    lineHash: "hash",
    repo: "github.com/re-cinq/lore",
    subjectKey: null,
    startItems: { pr_url: { kind: "value", ref: "https://pr/1", by: "lore" } },
    outcome: "error",
    reason: "review: iteration limit reached",
    finishedAt: "2026-09-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("reviewBroke", () => {
  it("is true for code-review settled as error", () => {
    expect(reviewBroke("code-review", "error")).toBe(true);
  });

  it("is true for code-review-recheck settled as failed", () => {
    expect(reviewBroke("code-review-recheck", "failed")).toBe(true);
  });

  it("is false for code-review settled as cancelled", () => {
    expect(reviewBroke("code-review", "cancelled")).toBe(false);
  });

  it("is false for code-review settled as success", () => {
    expect(reviewBroke("code-review", "success")).toBe(false);
  });

  it("is false for the line walk-note settled as error", () => {
    expect(reviewBroke("walk-note", "error")).toBe(false);
  });
});

describe("startValueOf", () => {
  it("reads pr_url from the run's start items", () => {
    expect(startValueOf(run(), "pr_url")).toBe("https://pr/1");
  });

  it("is undefined for head_sha when the run was started without one", () => {
    expect(startValueOf(run(), "head_sha")).toBeUndefined();
  });
});

describe("brokenReviewCheck", () => {
  it("fails lore/code-review on sha-1 with the run's reason and the re-run hint", () => {
    expect(brokenReviewCheck("sha-1", run())).toEqual({
      headSha: "sha-1",
      name: "lore/code-review",
      title: "Lore code-review",
      status: "completed",
      conclusion: "failure",
      summary:
        "The review did not complete: review: iteration limit reached. Comment `@lore review` to re-run the review.",
    });
  });

  it("publishes a broken re-check under lore/code-review", () => {
    expect(
      brokenReviewCheck("sha-1", run({ lineId: "code-review-recheck" })).name,
    ).toBe("lore/code-review");
  });

  it("names the outcome when the run carries no reason", () => {
    expect(brokenReviewCheck("sha-1", run({ reason: null })).summary).toContain(
      "The review did not complete: error.",
    );
  });
});
