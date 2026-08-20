import { describe, it, expect } from "vitest";
import {
  classifyError,
  isPermanentFailure,
  summarizeFailures,
  TaskFailure,
} from "./error-classify.js";

describe("classifyError", () => {
  it("returns anthropic-credit for a credit-balance message", () => {
    expect(
      classifyError(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
      ),
    ).toMatchObject({ category: "anthropic-credit" });
  });

  it("returns anthropic-rate-limit for a 429 rate limit message", () => {
    expect(classifyError("429 rate limit exceeded")).toMatchObject({
      category: "anthropic-rate-limit",
    });
  });

  it("returns github-permission for resource-not-accessible without a workflow path", () => {
    expect(
      classifyError("Resource not accessible by integration"),
    ).toMatchObject({ category: "github-permission" });
  });

  it("returns github-permission for a bare 403", () => {
    expect(classifyError("403 Forbidden")).toMatchObject({
      category: "github-permission",
    });
  });

  it("returns auth for a 401 bad credentials message", () => {
    expect(classifyError("401 Bad credentials")).toMatchObject({
      category: "auth",
    });
  });

  it("returns anthropic-credit for an insufficient-credit message", () => {
    expect(classifyError("insufficient credit for this request")).toMatchObject(
      {
        category: "anthropic-credit",
      },
    );
  });

  it("returns anthropic-credit for the agent's bare terminal text", () => {
    expect(classifyError("Credit balance is too low")).toMatchObject({
      category: "anthropic-credit",
    });
  });

  it("returns infra for a Job-level BackoffLimitExceeded", () => {
    expect(
      classifyError(
        "BackoffLimitExceeded: Job has reached the specified backoff limit",
      ),
    ).toMatchObject({ category: "infra" });
  });

  it("returns infra for a Job deadline and for an evicted pod", () => {
    expect(
      classifyError(
        "DeadlineExceeded: Job was active longer than the deadline",
      ),
    ).toMatchObject({ category: "infra" });
    expect(classifyError("Pod was Evicted: ephemeral storage")).toMatchObject({
      category: "infra",
    });
  });

  it("returns unknown for an unrecognized message", () => {
    expect(classifyError("something exploded")).toMatchObject({
      category: "unknown",
    });
  });

  it("includes a non-empty remediation hint for every category", () => {
    const messages = [
      "credit balance is too low",
      "429 rate limit",
      "Resource not accessible by integration",
      "401 Bad credentials",
      "BackoffLimitExceeded: Job has reached the specified backoff limit",
      "weird unmatched failure",
    ];

    for (const m of messages) {
      expect(classifyError(m).hint.length).toBeGreaterThan(0);
    }
  });
});

describe("isPermanentFailure", () => {
  it("returns true for the categories no retry can fix", () => {
    expect(isPermanentFailure("anthropic-credit")).toEqual(true);
    expect(isPermanentFailure("auth")).toEqual(true);
    expect(isPermanentFailure("github-permission")).toEqual(true);
    expect(isPermanentFailure("github-workflows-permission")).toEqual(true);
  });

  it("returns false for a rate limit, which a later attempt can clear", () => {
    expect(isPermanentFailure("anthropic-rate-limit")).toEqual(false);
  });

  it("returns false for infra and unknown, which are worth one retry", () => {
    expect(isPermanentFailure("infra")).toEqual(false);
    expect(isPermanentFailure("unknown")).toEqual(false);
  });
});

describe("summarizeFailures", () => {
  it("classifies a workflow-path resource error as github-workflows-permission", () => {
    const { details } = summarizeFailures([
      {
        step: ".github/workflows/lore-ingest.yml",
        error: "Resource not accessible by integration",
      },
    ]);

    expect(details[0]).toMatchObject({
      step: ".github/workflows/lore-ingest.yml",
      category: "github-workflows-permission",
    });
  });

  it("groups by category and counts each in the summary", () => {
    const { summary, details } = summarizeFailures([
      {
        step: ".github/PULL_REQUEST_TEMPLATE.md",
        error: "credit balance is too low",
      },
      { step: ".specify/spec.md", error: "credit balance is too low" },
      {
        step: ".github/workflows/lore-ingest.yml",
        error: "Resource not accessible by integration",
      },
    ]);

    expect(details).toHaveLength(3);
    expect(summary).toMatch(/credit/i);
    expect(summary).toMatch(/\(2/);
    expect(summary).toMatch(/workflows/i);
    expect(summary).toMatch(/\(1/);
  });

  it("returns an empty summary for no failures", () => {
    expect(summarizeFailures([])).toEqual({ summary: "", details: [] });
  });
});

describe("TaskFailure", () => {
  it("carries the summary as message and the structured details", () => {
    const details = [
      {
        step: ".specify/spec.md",
        category: "anthropic-credit" as const,
        error: "credit balance is too low",
        hint: "top up",
      },
    ];
    const err = new TaskFailure("summary text", details);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toEqual("summary text");
    expect(err.details).toEqual(details);
  });
});
