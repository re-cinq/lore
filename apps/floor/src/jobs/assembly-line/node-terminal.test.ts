import { describe, it, expect } from "vitest";
import {
  normalizeAgentStatus,
  postReviewFromNode,
  reviewNodeResultOverride,
} from "./node-terminal.js";
import type { ReviewPoster } from "../review/post-review.js";
import type {
  AuditLogEntry,
  AuditPort,
} from "@re-cinq/lore-shared/project/audit/audit-port.js";
import type { AssemblyLineRecord } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import type { AssemblyLineNode } from "@re-cinq/lore-assembly-lines";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

const reviewNode: AssemblyLineNode = {
  id: "review",
  type: "agent",
  prompt_ref: "code-review",
};
const plainNode: AssemblyLineNode = {
  id: "detect",
  type: "detect",
  job_ref: "x",
};

const row = (args: Record<string, unknown> = { pr_number: 841 }) =>
  ({
    id: "line-1",
    repo: "re-cinq/lore",
    definitionName: "code-review",
    status: "running",
    args,
  }) as unknown as AssemblyLineRecord;

function ports() {
  const reviews: Array<{ number: number; input: CreateReviewInput }> = [];
  const entries: AuditLogEntry[] = [];
  const poster: ReviewPoster = {
    createReview: async (number, input) => {
      reviews.push({ number, input });
    },
  };
  const audit: AuditPort = {
    write: async (entry) => {
      entries.push(entry);
    },
  };

  return { poster, audit, reviews, entries };
}

const findingsText = (verdict: string) =>
  [
    "```REVIEW_FINDINGS",
    JSON.stringify({
      verdict,
      summary: "s",
      findings: [
        {
          path: "a.ts",
          line: 1,
          label: "issue",
          decoration: "blocking",
          subject: "boom",
        },
      ],
    }),
    "```",
  ].join("\n");

describe("normalizeAgentStatus", () => {
  it("unwraps the NDJSON envelope into the agent text", () => {
    const output = JSON.stringify({
      type: "result",
      is_error: false,
      result: "REVIEW_RESULT:APPROVED",
    });

    expect(normalizeAgentStatus({ phase: "Succeeded", output })).toEqual({
      phase: "Succeeded",
      output: "REVIEW_RESULT:APPROVED",
    });
  });

  it("leaves plain output untouched", () => {
    expect(
      normalizeAgentStatus({ phase: "Succeeded", output: "plain text" }),
    ).toEqual({ phase: "Succeeded", output: "plain text" });
  });

  it("leaves a status without output untouched", () => {
    expect(normalizeAgentStatus({ phase: "Failed" })).toEqual({
      phase: "Failed",
    });
  });
});

describe("postReviewFromNode", () => {
  it("posts the findings of a code-review node", async () => {
    const p = ports();

    await postReviewFromNode(
      row(),
      reviewNode,
      findingsText("changes_requested"),
      p,
    );

    expect(p.reviews).toHaveLength(1);
    expect(p.reviews[0]?.number).toBe(841);
    expect(p.entries).toHaveLength(0);
  });

  it("posts nothing for a node that is not a code review", async () => {
    const p = ports();

    await postReviewFromNode(row(), plainNode, findingsText("approved"), p);

    expect(p.reviews).toHaveLength(0);
    expect(p.entries).toHaveLength(0);
  });

  it("posts nothing when the line carries no pr_number", async () => {
    const p = ports();

    await postReviewFromNode(row({}), reviewNode, findingsText("approved"), p);

    expect(p.reviews).toHaveLength(0);
  });

  it("audits a verdict that reached no parseable findings", async () => {
    const p = ports();

    await postReviewFromNode(
      row(),
      reviewNode,
      "REVIEW_RESULT:CHANGES_REQUESTED:no block here",
      p,
    );

    expect(p.reviews).toHaveLength(0);
    expect(p.entries).toMatchObject([
      {
        event_type: "review_findings_unparsed",
        repo: "re-cinq/lore",
        payload: { pr_number: 841, verdict: "changes_requested" },
      },
    ]);
  });

  it("audits a post that throws instead of swallowing it", async () => {
    const p = ports();
    const failing: ReviewPoster = {
      createReview: async () => {
        throw new Error("Resource not accessible by integration");
      },
    };

    await postReviewFromNode(row(), reviewNode, findingsText("approved"), {
      poster: failing,
      audit: p.audit,
    });

    expect(p.entries).toMatchObject([
      {
        event_type: "review_post_failed",
        repo: "re-cinq/lore",
        payload: {
          pr_number: 841,
          error: "Resource not accessible by integration",
        },
      },
    ]);
  });

  it("reports posted, no_findings, post_failed and not_review as its outcome", async () => {
    const p = ports();
    const failing: ReviewPoster = {
      createReview: async () => {
        throw new Error("boom");
      },
    };

    expect(
      await postReviewFromNode(row(), reviewNode, findingsText("approved"), p),
    ).toBe("posted");
    expect(
      await postReviewFromNode(row(), reviewNode, "no block here", p),
    ).toBe("no_findings");
    expect(
      await postReviewFromNode(row(), reviewNode, findingsText("approved"), {
        poster: failing,
        audit: p.audit,
      }),
    ).toBe("post_failed");
    expect(
      await postReviewFromNode(row(), plainNode, findingsText("approved"), p),
    ).toBe("not_review");
  });
});

describe("reviewNodeResultOverride", () => {
  it("fails the node when no findings parsed and no verdict was reached (the silent-review outage shape)", () => {
    const result = reviewNodeResultOverride(
      "no_findings",
      "I could not fetch the diff.",
      {
        outcome: "success",
      },
    );

    expect(result).toEqual({ outcome: "failed" });
  });

  it("keeps a verdict-carrying result even without a findings block (legitimate minimal approve)", () => {
    const result = reviewNodeResultOverride(
      "no_findings",
      "REVIEW_RESULT:APPROVED",
      { outcome: "success" },
    );

    expect(result).toEqual({ outcome: "success" });
  });

  it("keeps the result when findings were posted", () => {
    const result = reviewNodeResultOverride(
      "posted",
      findingsText("changes_requested"),
      { outcome: "changes_requested" },
    );

    expect(result).toEqual({ outcome: "changes_requested" });
  });

  it("keeps the result for non-review nodes", () => {
    const result = reviewNodeResultOverride("not_review", undefined, {
      outcome: "success",
    });

    expect(result).toEqual({ outcome: "success" });
  });
});
