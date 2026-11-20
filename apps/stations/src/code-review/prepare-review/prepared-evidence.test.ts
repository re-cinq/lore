import { describe, expect, it } from "vitest";
import { preparedEvidence } from "./prepared-evidence.js";

const collected = {
  test_evidence: { mode: "tests", files: [] },
  code_evidence: { mode: "code", files: [{ path: "limit.ts" }] },
  issue_evidence: { mode: "issue", discussion: [], specs: [] },
};

describe("preparedEvidence", () => {
  it("returns the three packets the collector printed", () => {
    expect(preparedEvidence(JSON.stringify(collected))).toEqual(collected);
  });

  it("hands the gaps still open to both checks of a re-check", () => {
    expect(
      preparedEvidence(JSON.stringify(collected), "limit.ts:1 off by one"),
    ).toMatchObject({
      code_evidence: { previous_gaps: "limit.ts:1 off by one" },
      issue_evidence: { previous_gaps: "limit.ts:1 off by one" },
    });
  });

  it("returns the outcome whole_diff with the collector's reason, a.bin is binary, in place of packets", () => {
    expect(
      preparedEvidence(
        JSON.stringify({ status: "whole_diff", reason: "a.bin is binary" }),
      ),
    ).toEqual({ outcome: "whole_diff", reason: "a.bin is binary" });
  });

  it("returns the outcome superseded for a commit that is no longer the head", () => {
    expect(preparedEvidence(JSON.stringify({ status: "superseded" }))).toEqual({
      outcome: "superseded",
    });
  });
});
