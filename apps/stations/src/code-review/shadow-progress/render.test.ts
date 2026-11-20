import { expect, it } from "vitest";
import {
  formalReview,
  reviewProgress,
  type ProgressResults,
} from "./render.js";

const REVISION = "a".repeat(40);

function agentOutput(result: object): string {
  return JSON.stringify({
    type: "result",
    result:
      JSON.stringify(result) + '\nLORE_NODE_RESULT: {"outcome":"success"}',
  });
}

const explanation = {
  status: "complete",
  evidence: [],
  requests: [],
};
const outputs: ProgressResults = {
  code_reading: agentOutput({
    ...explanation,
    reading: [
      "Maintainers can change the item name.",
      "Locked items retain their previous name.",
    ],
  }),
  test_reading: agentOutput({
    ...explanation,
    reading: ["The fixture shows that a locked item retains its name."],
  }),
  intent_comparison: agentOutput({
    status: "complete",
    summary: "The change matches the ticket.",
    findings: [],
  }),
  test_challenge: agentOutput({
    ...explanation,
    reading: ["No gap found for the supported inputs."],
  }),
  product_review: agentOutput({
    status: "complete",
    verdict: "approve",
    summary: "Maintainers gain a safe way to rename items.",
    findings: [],
  }),
};

it("publishes the original two code sentences, test evidence and proposed approval for a complete review", () => {
  expect(reviewProgress(outputs, 4).body(REVISION, "complete"))
    .toMatchInlineSnapshot(`
    "## Lore shadow review

    Reviewed revision \`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\` · **Proposed approval**

    The current review and its check carry the merge decision.

    ### Code reading

    Maintainers can change the item name. Locked items retain their previous name.

    ### Test reading

    The fixture shows that a locked item retains its name.

    ### Intent comparison

    The change matches the ticket.

    ### Test challenge

    No gap found for the supported inputs.

    ### Product review

    Maintainers gain a safe way to rename items."
  `);
});

it("marks malformed test evidence incomplete even when the product pass proposed approval", () => {
  expect(
    reviewProgress({ ...outputs, test_reading: "{}" }, 4).body(
      REVISION,
      "complete",
    ),
  ).toEqual(
    expect.stringMatching(
      /\*\*Incomplete\*\*[\s\S]+Incomplete passes — Test reading$/,
    ),
  );
});

it("marks a terminal failure incomplete even if all five outputs are present", () => {
  expect(reviewProgress(outputs, 5).body(REVISION, "failed")).toContain(
    "**Incomplete**",
  );
});

it("approves only after all five passes complete and accepts a single final JSON fence after a preamble", () => {
  const result = {
    status: "complete",
    verdict: "approve",
    summary: "Verified.",
    findings: [],
  };
  const final = [
    "I checked the supplied evidence.",
    "```json",
    JSON.stringify(result),
    "```",
    'LORE_NODE_RESULT: {"outcome":"success"}',
  ].join("\n");
  const reviewed = { ...outputs, product_review: final };

  expect({
    complete: formalReview(reviewed),
    missing: Object.keys(reviewed).map((name) =>
      formalReview({ ...reviewed, [name]: undefined }),
    ),
    incomplete: formalReview({
      ...reviewed,
      product_review: agentOutput({ ...result, verdict: "incomplete" }),
    }),
    malformed: formalReview({ ...reviewed, test_reading: "{}" }),
  }).toEqual({
    complete: { verdict: "approved", summary: "Verified.", findings: [] },
    missing: Array(5).fill(undefined),
    incomplete: undefined,
    malformed: undefined,
  });
});

it("requests changes for a blocking intent finding even when product approves and preserves unlocated evidence", () => {
  const finding = {
    severity: "blocking",
    subject: "Quantity",
    detail: "Negative quantity accepted.",
    evidence: ["ticket 7"],
  };
  const assessment = {
    ...outputs,
    intent_comparison: agentOutput({
      status: "complete",
      summary: "Mismatch",
      findings: [finding],
    }),
    product_review: agentOutput({
      status: "complete",
      verdict: "approve",
      summary: "Reviewed",
      findings: [
        {
          ...finding,
          subject: "Negative amount",
          location: { path: "amount.ts", line: 9 },
        },
      ],
    }),
  };

  expect(formalReview(assessment)).toMatchObject({
    verdict: "changes_requested",
    findings: [
      {
        path: "amount.ts",
        line: 9,
        subject: "Negative amount",
        decoration: "blocking",
      },
    ],
    generalFindings: [
      {
        subject: "Quantity",
        discussion: "Negative quantity accepted.\n\nticket 7",
      },
    ],
  });
});

it.each([
  ["code-review", true],
  ["code-review-recheck", true],
  ["code-review-shadow", false],
])(
  "an incomplete %s review says the whole diff is reviewed instead: %s",
  (lineId, said) => {
    expect(
      reviewProgress({}, 5, lineId)
        .body(REVISION, "failed")
        .includes("Lore reviews this revision from its whole diff instead."),
    ).toBe(said);
  },
);

it("reads a complete pass whose JSON follows notes that quote `code` and a fenced example", () => {
  const comparison = {
    status: "complete",
    summary: "The change matches the ticket.",
    findings: [],
  };
  const answer = [
    "**Alignment:** `claimAnnouncement` returns true once.",
    "```ts\nclaimAnnouncement(repo, version);\n```",
    "---",
    "```json\n" + JSON.stringify(comparison, null, 2) + "\n```",
    'LORE_NODE_RESULT: {"outcome":"success"}',
  ].join("\n\n");
  const intent_comparison = JSON.stringify({ type: "result", result: answer });

  expect(
    reviewProgress({ ...outputs, intent_comparison }, 2).incomplete,
  ).toEqual([]);
});
