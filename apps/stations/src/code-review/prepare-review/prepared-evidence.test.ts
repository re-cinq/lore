import { describe, expect, it } from "vitest";
import { preparedEvidence } from "./prepared-evidence.js";

const noDocs = { mode: "docs", statements: [], removed: [] };
const collected = {
  test_evidence: { mode: "tests", files: [] },
  code_evidence: { mode: "code", files: [{ path: "limit.ts" }] },
  issue_evidence: { mode: "issue", discussion: [], specs: [] },
  docs_evidence: noDocs,
};
const written = {
  mode: "docs",
  statements: [{ path: "README.md", line: 3, text: "The limit is 2." }],
  removed: [],
};
const prepared = (answer: object, previous?: string) =>
  preparedEvidence(JSON.stringify(answer), previous);

describe("preparedEvidence", () => {
  it("returns the four packets the collector printed and reports a story review whose documents did not change", () => {
    expect(prepared(collected)).toEqual({
      report: {
        outcome: "success",
        produced: { review_mode: "story", docs_changed: "false" },
      },
      packets: collected,
    });
  });

  it("reports docs_changed true when the pull request writes a statement beside its code", () => {
    expect(
      prepared({ ...collected, docs_evidence: written }).report.produced,
    ).toEqual({ review_mode: "story", docs_changed: "true" });
  });

  it("hands the gaps still open to the three checks of a re-check, and not to the story", () => {
    expect(prepared(collected, "limit.ts:1 off by one").packets).toEqual({
      test_evidence: collected.test_evidence,
      code_evidence: {
        ...collected.code_evidence,
        previous_gaps: "limit.ts:1 off by one",
      },
      issue_evidence: {
        ...collected.issue_evidence,
        previous_gaps: "limit.ts:1 off by one",
      },
      docs_evidence: { ...noDocs, previous_gaps: "limit.ts:1 off by one" },
    });
  });

  it("reports the outcome docs_only with the documents packet alone for a pull request of documents", () => {
    expect(prepared({ status: "docs_only", docs_evidence: written })).toEqual({
      report: {
        outcome: "docs_only",
        produced: { review_mode: "docs", docs_changed: "true" },
      },
      packets: { docs_evidence: written },
    });
  });

  it("reports the outcome links_only with no packet for a pull request that changes only links", () => {
    expect(prepared({ status: "links_only" })).toEqual({
      report: { outcome: "links_only", produced: { review_mode: "links" } },
      packets: {},
    });
  });

  it("reports the outcome whole_diff with the collector's reason, a.bin is binary, as whole_diff_reason in place of packets", () => {
    expect(
      prepared({ status: "whole_diff", reason: "a.bin is binary" }),
    ).toEqual({
      report: {
        outcome: "whole_diff",
        produced: { whole_diff_reason: "a.bin is binary" },
      },
      packets: {},
    });
  });

  it("reports the outcome whole_diff alone when the collector's reason is empty", () => {
    expect(prepared({ status: "whole_diff", reason: "" }).report).toEqual({
      outcome: "whole_diff",
    });
  });

  it("reports the outcome superseded for a commit that is no longer the head", () => {
    expect(prepared({ status: "superseded" }).report).toEqual({
      outcome: "superseded",
    });
  });

  it("reports the outcome superseded alone when the collector adds a reason, which belongs to whole_diff only", () => {
    expect(
      prepared({ status: "superseded", reason: "head moved" }).report,
    ).toEqual({ outcome: "superseded" });
  });
});
