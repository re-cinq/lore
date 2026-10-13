import { describe, it, expect } from "vitest";
import { decideRetry, MAX_ATTEMPTS, retryBudgetOf } from "./retry.js";

describe("decideRetry", () => {
  it("retries with 2s backoff after the first failed attempt", () => {
    expect(decideRetry({ attempts: 1 })).toEqual({
      kind: "retry",
      backoffSeconds: 2,
    });
  });

  it("backs off exponentially: 16s after the fourth attempt", () => {
    expect(decideRetry({ attempts: 4 })).toEqual({
      kind: "retry",
      backoffSeconds: 16,
    });
  });

  it("caps the backoff at 300 seconds", () => {
    expect(decideRetry({ attempts: 20 })).toEqual({ kind: "dead" });
    expect(decideRetry({ attempts: 4, max: 99 })).toEqual({
      kind: "retry",
      backoffSeconds: 16,
    });
    expect(decideRetry({ attempts: 12, max: 99 })).toEqual({
      kind: "retry",
      backoffSeconds: 300,
    });
  });

  it("dead-letters when attempts reaches the max", () => {
    expect(decideRetry({ attempts: MAX_ATTEMPTS })).toEqual({ kind: "dead" });
  });

  it("dead-letters past the max", () => {
    expect(decideRetry({ attempts: MAX_ATTEMPTS + 3 })).toEqual({
      kind: "dead",
    });
  });
});

describe("retryBudgetOf", () => {
  it("reads 10 off an error carrying maxAttempts 10", () => {
    expect(
      retryBudgetOf(Object.assign(new Error("early"), { maxAttempts: 10 })),
    ).toBe(10);
  });

  it("is undefined for an error without maxAttempts", () => {
    expect(retryBudgetOf(new Error("boom"))).toBeUndefined();
  });

  it("is undefined when maxAttempts is the text 10", () => {
    expect(retryBudgetOf({ maxAttempts: "10" })).toBeUndefined();
  });

  it("is undefined for a thrown string", () => {
    expect(retryBudgetOf("boom")).toBeUndefined();
  });
});
