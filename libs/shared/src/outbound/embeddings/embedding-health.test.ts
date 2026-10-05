import { describe, it, expect, beforeEach } from "vitest";
import {
  EMBEDDER_DEGRADED_AFTER,
  embedderDegraded,
  embeddingHealth,
  recordEmbeddingOutcome,
  resetEmbeddingHealth,
} from "./embedding-health.js";

beforeEach(() => resetEmbeddingHealth());

describe("embeddingHealth", () => {
  it("reports no outcomes and consecutiveFailures 0 before any call", () => {
    expect(embeddingHealth()).toEqual({
      lastOkAt: null,
      lastFailureAt: null,
      lastStatus: null,
      consecutiveFailures: 0,
    });
  });

  it("reports consecutiveFailures 2 and lastStatus 503 after refused outcomes 429 then 503", () => {
    recordEmbeddingOutcome({ ok: false, status: 429 });
    recordEmbeddingOutcome({ ok: false, status: 503 });

    expect(embeddingHealth()).toEqual({
      lastOkAt: null,
      lastFailureAt: expect.any(String),
      lastStatus: 503,
      consecutiveFailures: 2,
    });
  });

  it("clears consecutiveFailures to 0 and keeps lastStatus 429 after an ok outcome", () => {
    recordEmbeddingOutcome({ ok: false, status: 429 });
    recordEmbeddingOutcome({ ok: true });

    expect(embeddingHealth()).toEqual({
      lastOkAt: expect.any(String),
      lastFailureAt: expect.any(String),
      lastStatus: 429,
      consecutiveFailures: 0,
    });
  });

  it("hands out a copy, so setting consecutiveFailures 9 on it leaves the counter at 0", () => {
    embeddingHealth().consecutiveFailures = 9;

    expect(embeddingHealth().consecutiveFailures).toBe(0);
  });
});

describe("embedderDegraded", () => {
  it("is false after 2 failed outcomes and true after the 3rd", () => {
    recordEmbeddingOutcome({ ok: false, status: null });
    recordEmbeddingOutcome({ ok: false, status: null });
    const degradedAtTwo = embedderDegraded();

    recordEmbeddingOutcome({ ok: false, status: null });

    expect({ degradedAtTwo, degradedAtThree: embedderDegraded() }).toEqual({
      degradedAtTwo: false,
      degradedAtThree: true,
    });
  });

  it("judges the health it is handed: consecutiveFailures 3 is degraded while the process counter is 0", () => {
    const handed = {
      lastOkAt: null,
      lastFailureAt: null,
      lastStatus: 403,
      consecutiveFailures: EMBEDDER_DEGRADED_AFTER,
    };

    expect(embedderDegraded(handed)).toBe(true);
  });
});
