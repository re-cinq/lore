import { describe, expect, it } from "vitest";
import { preparedEvidence } from "./prepared-evidence.js";

const collected = {
  code_evidence: { mode: "code", files: [{ path: "limit.ts" }] },
  test_evidence: { mode: "tests", files: [] },
  intent_evidence: { mode: "intent", discussion: [] },
  challenge_evidence: { mode: "test challenge", files: [] },
  product_evidence: { mode: "product", specs: [] },
};

describe("preparedEvidence", () => {
  it("returns the five packets the collector printed", () => {
    expect(preparedEvidence(JSON.stringify(collected))).toEqual(collected);
  });

  it("adds the previous findings to the product packet of a re-check", () => {
    expect(
      preparedEvidence(JSON.stringify(collected), "limit.ts:1 off by one")
        ?.product_evidence,
    ).toEqual({
      mode: "product",
      specs: [],
      previous_findings: "limit.ts:1 off by one",
    });
  });

  it("returns nothing when the collector asks for the whole-diff reviewer", () => {
    const asked = { status: "whole_diff", reason: "Binary evidence for a.bin" };

    expect(preparedEvidence(JSON.stringify(asked))).toBeUndefined();
  });

  it("throws The pull request changed during evidence preparation when the collector reports superseded", () => {
    expect(() =>
      preparedEvidence(JSON.stringify({ status: "superseded" })),
    ).toThrow(
      new Error("The pull request changed during evidence preparation"),
    );
  });
});
