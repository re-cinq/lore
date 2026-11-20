import { describe, expect, it } from "vitest";
import { formalReview, storyReview, type PassOutputs } from "./story.js";

const REVISION = "a".repeat(40);
const TEST = "apps/api/test/systemPrompt.acceptance.test.ts";

function answer(result: object): string {
  return JSON.stringify({
    type: "result",
    result:
      "```json\n" +
      JSON.stringify(result) +
      '\n```\nLORE_NODE_RESULT: {"outcome":"success"}',
  });
}

const story = answer({
  status: "complete",
  story: [
    {
      id: 1,
      behaviour: "MASK_TOKEN_RULE is one of the response guidelines.",
      tests: [{ path: TEST, line: 6 }],
    },
  ],
});
const matches = answer({
  status: "complete",
  summary: "The implementation matches the story.",
  gaps: [],
});
const missingTest = {
  kind: "missing_test",
  story: 1,
  subject: "the rule is not in the identity section",
  detail: "FR-027 says so; no test tells it.",
  location: { path: TEST, line: 13 },
  proposal: "inIdentity: false,",
  evidence: ["specs/support-agent-prompt-and-model/spec.md FR-027"],
};
const issueGaps = (...gaps: object[]) =>
  answer({ status: "complete", summary: "One requirement is untold.", gaps });
const outputs = (issue_check: string): PassOutputs => ({
  story,
  implementation_check: matches,
  issue_check,
});

describe("storyReview", () => {
  it("shows the story alone as In progress once tell-story has answered", () => {
    expect(storyReview({ story }, 1).comment(REVISION, "running")).toBe(
      [
        "## Lore code review",
        `Reviewed revision \`${REVISION}\` · **In progress** · 1 story line, 0 gaps`,
        "### The story the tests tell",
        `1. MASK\\_TOKEN\\_RULE is one of the response guidelines.\n   \`${TEST}:6\``,
      ].join("\n\n"),
    );
  });

  it("lists a gap under the story with its kind, its subject and where, and asks for changes", () => {
    const comment = storyReview(outputs(issueGaps(missingTest)), 3).comment(
      REVISION,
      "complete",
    );

    expect(comment.split("\n\n").slice(1)).toEqual([
      `Reviewed revision \`${REVISION}\` · **Changes requested** · 1 story line, 1 gap`,
      "### The story the tests tell",
      `1. MASK\\_TOKEN\\_RULE is one of the response guidelines.\n   \`${TEST}:6\``,
      "### Gaps",
      [
        "| # | Kind | What differs | Where |",
        "|---|------|--------------|-------|",
        `| 1 | Missing test | the rule is not in the identity section | \`${TEST}:13\` |`,
      ].join("\n"),
      "The implementation matches the story.",
      "One requirement is untold.",
    ]);
  });

  it("says a change with no tests tells no story", () => {
    const untold = answer({ status: "complete", story: [] });

    expect(
      storyReview({ story: untold }, 1).comment(REVISION, "running"),
    ).toContain("The tests tell nothing about this change.");
  });

  it("names the passes that did not answer and says the whole diff is reviewed instead when the run failed", () => {
    const review = storyReview({ story, implementation_check: "{}" }, 2);

    expect([
      review.incomplete,
      review.comment(REVISION, "failed").split("\n\n").slice(-2),
    ]).toEqual([
      ["Implementation check"],
      [
        "Incomplete — Implementation check",
        "Lore reviews this revision from its whole diff instead.",
      ],
    ]);
  });
});

describe("formalReview", () => {
  it("approves with no finding when the implementation and the issue tell the tests' story", () => {
    expect(formalReview(outputs(issueGaps()))).toEqual({
      verdict: "approved",
      summary:
        "The tests tell 1 behaviour, and the implementation and the issue tell the same story.",
      findings: [],
    });
  });

  it("requests changes for a missing test and posts it on its line with the proposal as a code block", () => {
    expect(formalReview(outputs(issueGaps(missingTest)))).toEqual({
      verdict: "changes_requested",
      summary:
        "The tests tell 1 behaviour; 1 gap separates that story from the implementation and the issue.",
      findings: [
        {
          path: TEST,
          line: 13,
          label: "issue",
          decoration: "blocking",
          subject: "Missing test: the rule is not in the identity section",
          discussion: [
            "FR-027 says so; no test tells it.",
            "Proposed:\n\n```\ninIdentity: false,\n```",
            "specs/support-agent-prompt-and-model/spec.md FR-027",
          ].join("\n\n"),
        },
      ],
    });
  });

  it("posts a proposal that replaces its line as a suggestion", () => {
    const replacing = { ...missingTest, replaces_line: true };

    expect(
      formalReview(outputs(issueGaps(replacing)))?.findings[0],
    ).toMatchObject({
      suggestion: "inIdentity: false,",
      discussion: [
        "FR-027 says so; no test tells it.",
        "specs/support-agent-prompt-and-model/spec.md FR-027",
      ].join("\n\n"),
    });
  });

  it.each([
    ["contradiction", "changes_requested"],
    ["missing_implementation", "changes_requested"],
    ["untold", "approved"],
  ])("answers a lone %s gap with %s", (kind, verdict) => {
    expect(
      formalReview(outputs(issueGaps({ ...missingTest, kind })))?.verdict,
    ).toBe(verdict);
  });

  it("keeps a gap with no place in the pull request's files in the review body", () => {
    const { location: _nowhere, ...unplaced } = missingTest;

    expect(formalReview(outputs(issueGaps(unplaced)))).toMatchObject({
      findings: [],
      generalFindings: [
        { subject: "Missing test: the rule is not in the identity section" },
      ],
    });
  });

  it("returns nothing until all three passes are complete", () => {
    expect(formalReview({ story, implementation_check: matches })).toBe(
      undefined,
    );
  });

  it("lists the earlier gaps a re-check found closed", () => {
    const closing = answer({
      status: "complete",
      summary: "All earlier gaps are closed.",
      gaps: [],
      closed: ["the rule is not in the identity section"],
    });

    expect(formalReview(outputs(closing))?.summary).toBe(
      "The tests tell 1 behaviour, and the implementation and the issue tell the same story. Closed since the last review: the rule is not in the identity section.",
    );
  });
});
