import { describe, it, expect } from "vitest";
import { dedupeImplemented, referencedIssueNumbers } from "./dedupe.js";
import { closedIssue, mergedPr } from "./fixtures.js";

describe("referencedIssueNumbers", () => {
  it("reads closes, fixes and resolves references from the body", () => {
    expect(
      referencedIssueNumbers({
        title: "Digest",
        body: "Closes #12, fixes #13 and Resolved #14. See #15.",
      }),
    ).toEqual([12, 13, 14]);
  });

  it("reads a bare issue number from the title", () => {
    expect(referencedIssueNumbers({ title: "Fix login (#7)" })).toEqual([7]);
  });
});

describe("dedupeImplemented", () => {
  it("drops an issue a merged PR closes via its body", () => {
    const pr = mergedPr({ number: 1, body: "Closes #12" });

    expect(dedupeImplemented([pr], [closedIssue({ number: 12 })])).toEqual({
      prs: [pr],
      issues: [],
    });
  });

  it("drops an issue named in a PR title", () => {
    const pr = mergedPr({ number: 1, title: "Login (#12)" });

    expect(
      dedupeImplemented([pr], [closedIssue({ number: 12 })]).issues,
    ).toEqual([]);
  });

  it("keeps an issue no PR references", () => {
    const issue = closedIssue({ number: 99 });

    expect(
      dedupeImplemented([mergedPr({ number: 1, body: "Closes #12" })], [issue])
        .issues,
    ).toEqual([issue]);
  });
});
