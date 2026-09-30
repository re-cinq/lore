import { describe, expect, it } from "vitest";
import type { RunView, VisitView } from "@re-cinq/floor-client";
import {
  brokenReviewCheck,
  budgetSkipCheck,
  failedAgentVisitOf,
  isOutOfBudget,
  reviewBroke,
  startValueOf,
} from "./run-settled.js";

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    lineId: "code-review",
    lineHash: "hash",
    repo: "github.com/re-cinq/lore",
    subjectKey: null,
    startItems: { pr_url: { kind: "value", ref: "https://pr/1", by: "lore" } },
    createdAt: "2026-09-30T09:00:00.000Z",
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

  it("is true for code-review settled as iteration_max, its retry spent", () => {
    expect(reviewBroke("code-review", "iteration_max")).toBe(true);
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

function visit(overrides: Partial<VisitView> = {}): VisitView {
  return {
    id: "visit-1",
    runId: "run-1",
    nodeId: "review",
    iteration: 1,
    stationHash: null,
    agentDefinitionHash: null,
    brief: { iteration: 1, needs: {} },
    report: { outcome: "failed", error: "quota" },
    worker: null,
    requestedBy: null,
    deadline: null,
    resumedFrom: null,
    agentSettings: {
      model: "gemini-3.1-pro-preview",
      prompt: "review",
      image: "img",
      timeoutMinutes: 30,
    },
    ...overrides,
  };
}

describe("failedAgentVisitOf", () => {
  it("reads the error and model of the last failed agent visit", () => {
    const first = visit({ id: "v-1" });
    const retry = visit({
      id: "v-2",
      iteration: 2,
      report: { outcome: "failed", error: "429 insufficient_quota" },
    });

    expect(failedAgentVisitOf([first, retry])).toEqual({
      visitId: "v-2",
      iteration: 2,
      error: "429 insufficient_quota",
      model: "gemini-3.1-pro-preview",
    });
  });

  it("skips a failed station visit that has no agent settings", () => {
    expect(failedAgentVisitOf([visit({ agentSettings: null })])).toBeNull();
  });

  it("is null when no visit failed", () => {
    expect(
      failedAgentVisitOf([visit({ report: { outcome: "success" } })]),
    ).toBeNull();
  });

  it("reads an empty error when the failed visit reported none", () => {
    expect(
      failedAgentVisitOf([visit({ report: { outcome: "failed" } })])?.error,
    ).toBe("");
  });
});

describe("isOutOfBudget", () => {
  it("is true for a Gemini exceeded your current quota failure", () => {
    const failure = {
      visitId: "v-1",
      iteration: 1,
      error: "You exceeded your current quota",
    };

    expect(isOutOfBudget(failure)).toBe(true);
  });

  it("is false for a 429 rate limit failure", () => {
    const failure = {
      visitId: "v-1",
      iteration: 1,
      error: "429 Too Many Requests",
    };

    expect(isOutOfBudget(failure)).toBe(false);
  });

  it("is false when no agent visit failed", () => {
    expect(isOutOfBudget(null)).toBe(false);
  });
});

describe("budgetSkipCheck", () => {
  it("succeeds lore/code-review on sha-1 saying the review was approved without one", () => {
    expect(budgetSkipCheck("sha-1", run())).toEqual({
      headSha: "sha-1",
      name: "lore/code-review",
      title: "Lore code-review",
      status: "completed",
      conclusion: "success",
      summary:
        "Approved without review: the LLM budget is exhausted. Comment `@lore review` to re-run the review.",
    });
  });
});
