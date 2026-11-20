import { describe, expect, it } from "vitest";
import {
  formalReview,
  storyPasses,
  storyReview,
  type PassOutputs,
} from "./story.js";

const upTo = (count: number) => storyPasses.slice(0, count);

const REVISION = "a".repeat(40);
const TEST = "apps/api/test/systemPrompt.acceptance.test.ts";

function answer(result: object): string {
  return (
    "```json\n" +
    JSON.stringify(result) +
    '\n```\nLORE_NODE_RESULT: {"outcome":"success"}'
  );
}

const story = answer({
  status: "complete",
  summary: "The system prompt gains a rule for mask tokens.",
  story: [
    {
      text: "The system prompt carries MASK_TOKEN_RULE among its response guidelines.",
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
  it("shows the short story, with the full story and its tests folded under it, as In progress once tell-story has answered", () => {
    expect(storyReview({ story }, upTo(1)).comment(REVISION, "running")).toBe(
      [
        "## Lore code review",
        `Reviewed revision \`${REVISION}\` · **In progress** · 0 gaps`,
        "### The story the tests tell",
        "The system prompt gains a rule for mask tokens.",
        "<details><summary>The full story, with its tests</summary>",
        "The system prompt carries MASK\\_TOKEN\\_RULE among its response guidelines.",
        `Tests: \`${TEST}\` (6)`,
        "</details>",
      ].join("\n\n"),
    );
  });

  it("lists a gap under the story with its kind, its subject and where, and asks for changes", () => {
    const comment = storyReview(
      outputs(issueGaps(missingTest)),
      upTo(3),
    ).comment(REVISION, "complete");

    expect(comment.split("\n\n").slice(1)).toEqual([
      `Reviewed revision \`${REVISION}\` · **Changes requested** · 1 gap`,
      "### The story the tests tell",
      "The system prompt gains a rule for mask tokens.",
      "<details><summary>The full story, with its tests</summary>",
      "The system prompt carries MASK\\_TOKEN\\_RULE among its response guidelines.",
      `Tests: \`${TEST}\` (6)`,
      "</details>",
      "### Gaps",
      [
        "| # | Kind | What differs | Where |",
        "|---|------|--------------|-------|",
        `| 1 | Missing test | the rule is not in the identity section | \`${TEST}:13\` |`,
      ].join("\n"),
      "<details><summary>What the checks read</summary>",
      "The implementation matches the story.",
      "One requirement is untold.",
      "</details>",
    ]);
  });

  it("shows a story told without a short version in full: a real enumeration as a list under its paragraph, inline code kept, each test file named once with its lines", () => {
    const told = answer({
      status: "complete",
      story: [
        {
          text: "A person who cannot read a repository is refused wherever the request names it:",
          list: ["in the path", "in the query"],
          tests: [
            { path: TEST, line: 27 },
            { path: TEST, line: 40 },
          ],
        },
        { text: "A `service` token reaches every repository.", tests: [] },
      ],
    });

    expect(
      storyReview({ story: told }, upTo(1))
        .comment(REVISION, "running")
        .split("\n\n")
        .slice(3),
    ).toEqual([
      "A person who cannot read a repository is refused wherever the request names it:",
      "- in the path\n- in the query",
      `Tests: \`${TEST}\` (27, 40)`,
      "A `service` token reaches every repository.",
    ]);
  });

  it("says a change with no tests tells no story", () => {
    const untold = answer({ status: "complete", story: [] });

    expect(
      storyReview({ story: untold }, upTo(1)).comment(REVISION, "running"),
    ).toContain("The tests tell nothing about this change.");
  });

  it("names the passes that did not answer and says the whole diff is reviewed instead when the run failed", () => {
    const review = storyReview({ story, implementation_check: "{}" }, upTo(2));

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
        "The implementation and the issue tell the story the tests tell.",
      findings: [],
    });
  });

  it("requests changes for a missing test and posts it on its line with the proposal as a code block", () => {
    expect(formalReview(outputs(issueGaps(missingTest)))).toEqual({
      verdict: "changes_requested",
      summary:
        "1 gap separates the story the tests tell from the implementation and the issue.",
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
            "Evidence: specs/support-agent-prompt-and-model/spec.md FR-027",
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
        "Evidence: specs/support-agent-prompt-and-model/spec.md FR-027",
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

  it("keeps a gap whose evidence is given as path, line and note objects, and names all of it on one line marked Evidence", () => {
    const evidence = [
      { path: "limit.ts", line: 4, spec: "caps at 2" },
      "limit.test.ts 9",
    ];

    expect(
      formalReview(outputs(issueGaps({ ...missingTest, evidence })))
        ?.findings[0]?.discussion,
    ).toBe(
      [
        "FR-027 says so; no test tells it.",
        "Proposed:\n\n```\ninIdentity: false,\n```",
        "Evidence: limit.ts 4 caps at 2; limit.test.ts 9",
      ].join("\n\n"),
    );
  });

  it("leaves inline code as written, so changes_requested and a[0] carry no backslash, and escapes the prose around it", () => {
    const named = {
      ...missingTest,
      subject: "`changes_requested` is never told",
      detail: "The reply reads `a[0]` and then a_b *twice*.",
    };

    expect(formalReview(outputs(issueGaps(named)))?.findings[0]).toMatchObject({
      subject: "Missing test: `changes_requested` is never told",
      discussion: expect.stringContaining(
        "The reply reads `a[0]` and then a\\_b \\*twice\\*.",
      ),
    });
  });

  it("shows inline code in a check's note as written, and escapes the prose around it", () => {
    const noted = answer({
      status: "complete",
      summary: "`changes_requested` and `a[0]` hold, but a_b does not.",
      gaps: [],
    });

    expect(
      storyReview({ story, implementation_check: noted }, upTo(2)).comment(
        REVISION,
        "running",
      ),
    ).toContain("`changes_requested` and `a[0]` hold, but a\\_b does not.");
  });

  it("returns nothing until all three passes are complete", () => {
    expect(formalReview({ story, implementation_check: matches })).toBe(
      undefined,
    );
  });

  it("approves when the only gap left is one a person declined to fix, and says who declined it where", () => {
    const declining = answer({
      status: "complete",
      summary: "One gap was declined.",
      gaps: [],
      declined: [
        {
          subject: "the rule is not in the identity section",
          reply: "https://github.com/re-cinq/Otto/pull/794#discussion_r1",
        },
      ],
    });
    const review = outputs(declining);

    expect([
      formalReview(review),
      storyReview(review, upTo(3))
        .comment(REVISION, "complete")
        .split("\n\n")
        .at(-5),
    ]).toEqual([
      {
        verdict: "approved",
        summary:
          "The implementation and the issue tell the story the tests tell. Declined by a person and not blocking: the rule is not in the identity section.",
        findings: [],
      },
      "Declined by a person, not blocking:\n- the rule is not in the identity section ([reply](https://github.com/re-cinq/Otto/pull/794#discussion_r1))",
    ]);
  });

  it("drops a check's answer whose declined gap links no reply, so nothing is waived on a model's word alone", () => {
    const unproven = answer({
      status: "complete",
      summary: "One gap was declined.",
      gaps: [],
      declined: [{ subject: "the rule is not in the identity section" }],
    });

    expect(formalReview(outputs(unproven))).toBe(undefined);
  });

  it("lists the earlier gaps a re-check found closed", () => {
    const closing = answer({
      status: "complete",
      summary: "All earlier gaps are closed.",
      gaps: [],
      closed: ["the rule is not in the identity section"],
    });

    expect(
      storyReview(outputs(closing), upTo(3))
        .comment(REVISION, "complete")
        .split("\n\n")
        .at(-5),
    ).toBe(
      "Closed since the last review:\n- the rule is not in the identity section",
    );
  });

  it("lists a gap both checks found closed once, in the words of the first, when the second differs only in case and spacing", () => {
    const closing = (subject: string) =>
      answer({
        status: "complete",
        summary: "All earlier gaps are closed.",
        gaps: [],
        closed: [subject],
      });
    const comment = storyReview(
      {
        story,
        implementation_check: closing(
          "the rule is not in the identity section",
        ),
        issue_check: closing("The rule is  not in the identity section"),
      },
      upTo(3),
    ).comment(REVISION, "complete");

    expect(comment.match(/the rule is +not in the identity section/gi)).toEqual(
      ["the rule is not in the identity section"],
    );
  });

  it("keeps the closed gaps out of the review GitHub is given, which the next re-check is handed as the gaps left open", () => {
    const closing = answer({
      status: "complete",
      summary: "All earlier gaps are closed.",
      gaps: [],
      closed: ["the rule is not in the identity section"],
    });

    expect(formalReview(outputs(closing))?.summary).toBe(
      "The implementation and the issue tell the story the tests tell.",
    );
  });

  it("lists a gap both checks report declined, with the same reply, once", () => {
    const declining = answer({
      status: "complete",
      summary: "One gap was declined.",
      gaps: [],
      declined: [
        {
          subject: "the rule is not in the identity section",
          reply: "https://github.com/re-cinq/Otto/pull/794#discussion_r1",
        },
      ],
    });

    expect(
      formalReview({
        story,
        implementation_check: declining,
        issue_check: declining,
      })?.summary,
    ).toBe(
      "The implementation and the issue tell the story the tests tell. Declined by a person and not blocking: the rule is not in the identity section.",
    );
  });
});

describe("a pull request of documents", () => {
  const SPEC = "specs/queue/spec.md";
  const docs = (...gaps: object[]) =>
    answer({
      status: "complete",
      summary: "Every statement was read against its tests.",
      gaps,
    });
  const unproven = {
    kind: "contradiction",
    subject: "the linked test refuses item 26, the statement says item 25",
    detail: "The test fills 25 items and refuses the next one.",
    location: { path: SPEC, line: 5 },
    proposal: "- A full queue of 25 refuses item 26.",
    replaces_line: true,
  };

  it("approves a pull request of documents alone when the documents check finds no gap, with no story", () => {
    expect(formalReview({ docs_check: docs() }, ["docs_check"])).toEqual({
      verdict: "approved",
      summary:
        "The changed documents say what their linked tests and the code say.",
      findings: [],
    });
  });

  it("asks for changes on line 5 of the spec when the statement there says something else than its linked test", () => {
    expect(
      formalReview({ docs_check: docs(unproven) }, ["docs_check"]),
    ).toMatchObject({
      verdict: "changes_requested",
      summary:
        "1 gap separates the changed documents from their linked tests and the code.",
      findings: [
        {
          path: SPEC,
          line: 5,
          decoration: "blocking",
          suggestion: "- A full queue of 25 refuses item 26.",
        },
      ],
    });
  });

  it("approves and only notes a statement that links no test", () => {
    const unlinked = {
      kind: "unlinked",
      subject: "a queue holds 25 items",
      detail: "The statement is testable and links no test.",
      location: { path: SPEC, line: 6 },
    };

    expect(
      formalReview({ docs_check: docs(unlinked) }, ["docs_check"]),
    ).toMatchObject({
      verdict: "approved",
      findings: [
        {
          line: 6,
          label: "question",
          decoration: "non-blocking",
          subject: "No test link: a queue holds 25 items",
        },
      ],
    });
  });

  it("approves a pull request that changes only links without any pass, and says so in the review and the comment", () => {
    expect([
      formalReview({}, []),
      storyReview({}, []).comment(REVISION, "complete").split("\n\n").slice(1),
    ]).toEqual([
      {
        verdict: "approved",
        summary:
          "Only links changed in the Markdown of this pull request: nothing to review.",
        findings: [],
      },
      [
        `Reviewed revision \`${REVISION}\` · **Approved** · 0 gaps`,
        "Only links changed in the Markdown of this pull request: nothing to review.",
      ],
    ]);
  });

  it("gives no review of a pull request of code and documents until the documents check is complete too", () => {
    expect(formalReview(outputs(matches), [...storyPasses, "docs_check"])).toBe(
      undefined,
    );
  });

  it("counts the gap of the documents check with the story's in one review, and names the check that did not answer", () => {
    const reviewed = { ...outputs(matches), docs_check: docs(unproven) };

    expect([
      formalReview(reviewed, [...storyPasses, "docs_check"])?.summary,
      storyReview(outputs(matches), [...storyPasses, "docs_check"]).incomplete,
    ]).toEqual([
      "1 gap separates the story the tests tell from the implementation, the issue and the changed documents.",
      ["Documents check"],
    ]);
  });
});
