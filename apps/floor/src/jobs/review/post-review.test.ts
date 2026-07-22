import { describe, it, expect } from "vitest";
import {
  postReview,
  maybePostReview,
  partitionByHunks,
  type ReviewPoster,
} from "./post-review.js";
import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import type { CommentablePositions } from "@re-cinq/lore-shared/review/diff-hunks.js";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type {
  ReviewFinding,
  ReviewOutput,
} from "@re-cinq/lore-shared/review/review-findings.js";

/** Build commentable positions (right side) from (path, line) pairs. */
function positions(...entries: Array<[string, number]>): CommentablePositions {
  const right = new Map<string, Set<number>>();

  for (const [path, line] of entries) {
    const set = right.get(path) ?? new Set<number>();

    set.add(line);
    right.set(path, set);
  }

  return { right, left: new Map() };
}

function recorder(opts: { createReviewThrows?: boolean } = {}) {
  const calls: Array<{ number: number; input: CreateReviewInput }> = [];
  const comments: Array<{ number: number; body: string }> = [];
  const createReview = opts.createReviewThrows
    ? async () => {
        throw new Error("line must be part of the diff");
      }
    : async (number: number, input: CreateReviewInput) => {
        calls.push({ number, input });
      };
  const pulls: ReviewPoster = {
    createReview,
    comment: async (number, body) => {
      comments.push({ number, body });
    },
    getDiff: async () => "",
  };

  return { pulls, calls, comments };
}

const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  path: "src/a.ts",
  line: 12,
  label: "issue",
  decoration: "blocking",
  subject: "null deref",
  ...over,
});

describe("partitionByHunks", () => {
  it("keeps findings on commentable lines inline and folds the rest into overflow", () => {
    const inHunk = finding({ path: "src/a.ts", line: 12 });
    const outOfHunk = finding({ path: "src/a.ts", line: 99 });
    const outOfDiff = finding({ path: "CLAUDE.md", line: 3 });

    expect(
      partitionByHunks(
        [inHunk, outOfHunk, outOfDiff],
        positions(["src/a.ts", 12]),
      ),
    ).toEqual({ inline: [inHunk], overflow: [outOfHunk, outOfDiff] });
  });
});

describe("postReview", () => {
  it("posts one COMMENT review with a rendered comment per commentable finding and a summary", async () => {
    const { pulls, calls } = recorder();
    const output: ReviewOutput = {
      verdict: "changes_requested",
      findings: [
        finding({ suggestion: "const x = y ?? 0;" }),
        {
          path: "src/b.ts",
          line: 3,
          side: "LEFT",
          label: "nit",
          subject: "rename",
        },
      ],
    };

    await postReview(pulls, 7, output, {
      right: new Map([["src/a.ts", new Set([12])]]),
      left: new Map([["src/b.ts", new Set([3])]]),
    });

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
    expect(calls[0]?.input.body).toContain(
      "### Lore review — Changes suggested",
    );
  });

  it("folds a finding on an uninlineable line into the body, never inline (the 422 trap)", async () => {
    const { pulls, calls } = recorder();
    const output: ReviewOutput = {
      verdict: "changes_requested",
      findings: [
        finding({ path: "src/a.ts", line: 12, subject: "in-hunk issue" }),
        finding({ path: "src/a.ts", line: 99, subject: "out-of-hunk note" }),
      ],
    };

    await postReview(pulls, 7, output, positions(["src/a.ts", 12]));

    expect(calls[0]?.input.comments).toHaveLength(1);
    expect(calls[0]?.input.comments[0]?.line).toBe(12);
    expect(calls[0]?.input.body).toContain(
      "### Notes on lines outside changed hunks",
    );
    expect(calls[0]?.input.body).toContain("out-of-hunk note");
  });

  it("falls back to one top-level comment when the atomic review post is rejected", async () => {
    const { pulls, calls, comments } = recorder({ createReviewThrows: true });
    const output: ReviewOutput = {
      verdict: "changes_requested",
      findings: [finding({ path: "src/a.ts", line: 12, subject: "boom" })],
    };

    await postReview(pulls, 7, output, positions(["src/a.ts", 12]));

    expect(calls).toHaveLength(0);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ number: 7 });
    expect(comments[0]?.body).toContain("boom");
  });
});

describe("maybePostReview", () => {
  it("posts when the output carries a REVIEW_FINDINGS block", async () => {
    const { pulls, calls } = recorder();
    const output = `\`\`\`REVIEW_FINDINGS\n${JSON.stringify({
      verdict: "approved",
      findings: [],
    })}\n\`\`\``;

    expect(await maybePostReview(pulls, 7, output, positions())).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("posts a visible approval review for a bare REVIEW_RESULT:APPROVED with no findings block", async () => {
    const { pulls, calls } = recorder();

    expect(
      await maybePostReview(pulls, 7, "REVIEW_RESULT:APPROVED", positions()),
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input.comments).toHaveLength(0);
    expect(calls[0]?.input.body).toContain("Approved");
  });

  it("does nothing when there is no findings block and no approval verdict", async () => {
    const { pulls, calls } = recorder();

    expect(
      await maybePostReview(
        pulls,
        7,
        "REVIEW_RESULT:CHANGES_REQUESTED:but no block",
        positions(),
      ),
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

/**
 * Characterization of the real production payload (PR #841). `Agent.status.output`
 * is an NDJSON stream carrying the agent text inside a JSON string field, so the
 * fenced block's newlines arrive escaped. The findings regex needs a literal
 * newline, so the raw stream parses to nothing — the review node recorded
 * `changes_requested` while zero comments reached the PR. `resultTextFromOutput`
 * unwraps the envelope; only then does the poster see what the agent printed.
 */
describe("maybePostReview on a real Agent status.output stream", () => {
  const path = "tools/eslint-plugin-lore/rules/lib/intro-paragraph.mjs";
  const agentText = [
    "Now I have everything needed for a thorough review.",
    "",
    "```REVIEW_FINDINGS",
    JSON.stringify({
      verdict: "changes_requested",
      summary: "One correctness bug lets structural lines pad the minimum.",
      findings: [
        {
          path,
          line: 95,
          label: "issue",
          decoration: "blocking",
          subject: "Structural lines are pushed into the paragraph buffer",
          suggestion:
            "if (isProseLine(line)) {\n  paragraph.push(line.trim());\n}",
        },
      ],
    }),
    "```",
    "",
    "REVIEW_RESULT:CHANGES_REQUESTED:Logic bug in hasLeadParagraph",
  ].join("\n");

  const ndjson = [
    JSON.stringify({ type: "log", message: "cloning repo" }),
    JSON.stringify({ type: "result", is_error: false, result: agentText }),
  ].join("\n");

  it("parses nothing from the raw NDJSON envelope", async () => {
    const { pulls, calls } = recorder();

    expect(
      await maybePostReview(pulls, 841, ndjson, positions([path, 95])),
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("posts every finding once the envelope is unwrapped", async () => {
    const { pulls, calls } = recorder();

    expect(
      await maybePostReview(
        pulls,
        841,
        resultTextFromOutput(ndjson),
        positions([path, 95]),
      ),
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input.comments).toMatchObject([{ path, line: 95 }]);
    expect(calls[0]?.input.body).toContain("Changes suggested");
  });
});
