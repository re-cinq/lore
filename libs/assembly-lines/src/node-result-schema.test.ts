import { describe, it, expect } from "vitest";
import { NodeResultSchema } from "./node-result-schema.js";

/**
 * The NodeResult crosses a process boundary now: a station reporting a node's
 * outcome over `assembly_run.resume` sends it as JSON, so the receiving end must
 * validate it rather than cast. The same argument that gave StationInput a
 * schema applies the moment the shape stops being an in-process interface.
 */
describe("NodeResultSchema", () => {
  it("accepts an outcome on its own, which is all a human station reports", () => {
    expect(NodeResultSchema.parse({ outcome: "success" })).toEqual({
      outcome: "success",
    });
  });

  it("keeps the extras a follow-up is routed on, rather than dropping them", () => {
    expect(
      NodeResultSchema.parse({
        outcome: "success",
        extras: { action: "address", "Lore-Triage": "approved" },
      }).extras,
    ).toEqual({ action: "address", "Lore-Triage": "approved" });
  });

  it("keeps the failure class the dispatch gate trips on", () => {
    expect(
      NodeResultSchema.parse({
        outcome: "failed",
        failureClass: "anthropic-credit",
        failureDetail: "Credit balance too low",
      }),
    ).toMatchObject({
      failureClass: "anthropic-credit",
      failureDetail: "Credit balance too low",
    });
  });

  it("refuses an outcome the walk cannot route", () => {
    expect(() => NodeResultSchema.parse({ outcome: "maybe" })).toThrow();
  });

  it("refuses a failure class nothing classifies", () => {
    expect(() =>
      NodeResultSchema.parse({ outcome: "failed", failureClass: "vibes" }),
    ).toThrow();
  });

  it("refuses non-string extras, which would reach a trailer as [object Object]", () => {
    expect(() =>
      NodeResultSchema.parse({ outcome: "success", extras: { action: 7 } }),
    ).toThrow();
  });
});

describe("NodeResultSchema usage", () => {
  it("keeps every field of a reported cost, including the duration", () => {
    const usage = {
      inputTokens: 120,
      outputTokens: 40,
      costUsd: 0.0031,
      durationMs: 1450,
      model: "claude-haiku-4-5-20251001",
    };

    expect(NodeResultSchema.parse({ outcome: "success", usage }).usage).toEqual(
      usage,
    );
  });

  it("refuses a partial cost report rather than storing a half-priced one", () => {
    expect(() =>
      NodeResultSchema.parse({
        outcome: "success",
        usage: { inputTokens: 1, outputTokens: 2 },
      }),
    ).toThrow();
  });
});
