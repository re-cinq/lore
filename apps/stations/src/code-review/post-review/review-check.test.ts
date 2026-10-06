import { describe, it, expect } from "vitest";
import {
  findingCountOf,
  reviewCheck,
  reviewVerdictOf,
} from "./review-check.js";

const approvedBlock = `\`\`\`REVIEW_FINDINGS\n${JSON.stringify({ verdict: "approved", findings: [] })}\n\`\`\``;

describe("reviewVerdictOf and findingCountOf", () => {
  it("reads success and zero findings from an approved findings block", () => {
    expect([
      reviewVerdictOf(approvedBlock),
      findingCountOf(approvedBlock),
    ]).toEqual(["success", 0]);
  });

  it("reads changes_requested from a bare REVIEW_RESULT line with no block", () => {
    expect(reviewVerdictOf("REVIEW_RESULT:CHANGES_REQUESTED:x")).toBe(
      "changes_requested",
    );
  });
});

describe("reviewCheck", () => {
  it("concludes success on the lore/code-review check for the success verdict", () => {
    expect(
      reviewCheck({
        headSha: "abc123",
        verdict: "success",
        summary: "Approved, 0 findings",
      }),
    ).toEqual({
      headSha: "abc123",
      name: "lore/code-review",
      title: "Lore code-review",
      status: "completed",
      conclusion: "success",
      summary: "Approved, 0 findings",
    });
  });

  it("concludes neutral for the changes_requested verdict", () => {
    expect(
      reviewCheck({
        headSha: "abc123",
        verdict: "changes_requested",
        summary: "Changes requested, 2 findings",
      }),
    ).toMatchObject({ status: "completed", conclusion: "neutral" });
  });
});
