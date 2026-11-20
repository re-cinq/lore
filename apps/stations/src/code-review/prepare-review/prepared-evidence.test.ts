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
      preparedEvidence(JSON.stringify(collected), "limit.ts:1 off by one"),
    ).toMatchObject({
      product_evidence: {
        mode: "product",
        specs: [],
        previous_findings: "limit.ts:1 off by one",
      },
    });
  });

  it.each(["whole_diff", "superseded"])(
    "returns the outcome %s when the collector answers it in place of packets",
    (status) => {
      expect(
        preparedEvidence(JSON.stringify({ status, reason: "a.bin" })),
      ).toBe(status);
    },
  );
});
