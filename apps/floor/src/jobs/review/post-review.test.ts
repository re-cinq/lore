import { describe, it, expect } from "vitest";
import { postReview, maybePostReview, type ReviewPoster } from "./post-review.js";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { ReviewOutput } from "@re-cinq/lore-shared/review/review-findings.js";

function recorder() {
  const calls: Array<{ number: number; input: CreateReviewInput }> = [];
  const pulls: ReviewPoster = {
    createReview: async (number, input) => {
      calls.push({ number, input });
    },
  };

  return { pulls, calls };
}

describe("postReview", () => {
  it("posts one COMMENT review with a rendered comment per finding and a summary", async () => {
    const { pulls, calls } = recorder();
    const output: ReviewOutput = {
      verdict: "changes_requested",
      findings: [
        {
          path: "src/a.ts",
          line: 12,
          label: "issue",
          decoration: "blocking",
          subject: "null deref",
          suggestion: "const x = y ?? 0;",
        },
        { path: "src/b.ts", line: 3, side: "LEFT", label: "nit", subject: "rename" },
      ],
    };

    await postReview(pulls, 7, output);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      number: 7,
      input: {
        event: "COMMENT",
        comments: [
          {
            path: "src/a.ts",
            line: 12,
            body: "**issue (blocking):** null deref\n\n```suggestion\nconst x = y ?? 0;\n```",
          },
          { path: "src/b.ts", line: 3, side: "LEFT", body: "**nit:** rename" },
        ],
      },
    });
    expect(calls[0]?.input.body).toContain("### Lore review — Changes suggested");
  });
});

describe("maybePostReview", () => {
  it("posts when the output carries a REVIEW_FINDINGS block", async () => {
    const { pulls, calls } = recorder();
    const output = `\`\`\`REVIEW_FINDINGS\n${JSON.stringify({
      verdict: "approved",
      findings: [],
    })}\n\`\`\``;

    expect(await maybePostReview(pulls, 7, output)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("does nothing when there is no findings block", async () => {
    const { pulls, calls } = recorder();

    expect(await maybePostReview(pulls, 7, "REVIEW_RESULT:APPROVED")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
