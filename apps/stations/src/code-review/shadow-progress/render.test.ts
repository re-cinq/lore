import { expect, it } from "vitest";
import { reviewProgress, type ProgressResults } from "./render.js";

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
