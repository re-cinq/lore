import { describe, it, expect } from "vitest";
import {
  normalizeAgentStatus,
  postReplyFromNode,
  postReviewFromNode,
  reviewNodeResultOverride,
  type ReplyPoster,
} from "./node-terminal.js";
import type { ReviewPoster } from "../review/post-review.js";
import type {
  AuditLogEntry,
  AuditPort,
} from "@re-cinq/lore-shared/project/audit/audit-port.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

const reviewNode: RunGraphNode = {
  station: null,
  station_inherited: false,
  id: "review",
  type: "agent",
  prompt_ref: "code-review",
};
const plainNode: RunGraphNode = {
  station: null,
  station_inherited: false,
  id: "detect",
  type: "detect",
  job_ref: "x",
};
const refineNode: RunGraphNode = {
  station: null,
  station_inherited: false,
  id: "reply",
  type: "agent",
  prompt_ref: "code-review-refine",
};

const replyText = (body: string) =>
  ["```REVIEW_REPLY", body, "```", "REVIEW_RESULT:APPROVED"].join("\n");

function replyPorts() {
  const replies: Array<{ number: number; commentId: number; body: string }> =
    [];
  const comments: Array<{ number: number; body: string }> = [];
  const entries: AuditLogEntry[] = [];
  const poster: ReplyPoster = {
    replyToReviewComment: async (number, commentId, body) => {
      replies.push({ number, commentId, body });
    },
    comment: async (number, body) => {
      comments.push({ number, body });
    },
  };
  const audit: AuditPort = {
    write: async (entry) => {
      entries.push(entry);
    },
  };

  return { poster, audit, replies, comments, entries };
}

const row = (args: Record<string, unknown> = { pr_number: 841 }) =>
  ({
    id: "line-1",
    repo: "re-cinq/lore",
    blueprintName: "code-review",
    status: "running",
    args,
  }) as unknown as AssemblyRunRecord;

function ports() {
  const reviews: Array<{ number: number; input: CreateReviewInput }> = [];
  const entries: AuditLogEntry[] = [];
  const comments: Array<{ number: number; body: string }> = [];
  const poster: ReviewPoster = {
    createReview: async (number, input) => {
      reviews.push({ number, input });
    },
    comment: async (number, body) => {
      comments.push({ number, body });
    },
    getDiff: async () =>
      ["--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-old", "+boom"].join("\n"),
  };
  const audit: AuditPort = {
    write: async (entry) => {
      entries.push(entry);
    },
  };

  return { poster, audit, reviews, comments, entries };
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

  it("lifts the agent's terminal error text off the raw stream before unwrapping", () => {
    const output = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Credit balance is too low",
    });

    expect(normalizeAgentStatus({ phase: "Failed", output })).toEqual({
      phase: "Failed",
      output: "Credit balance is too low",
      errorText: "Credit balance is too low",
    });
  });

  it("carries no error text when the stream ended without an error result", () => {
    const output = JSON.stringify({
      type: "result",
      is_error: false,
      result: "REVIEW_RESULT:APPROVED",
    });

    expect(normalizeAgentStatus({ phase: "Succeeded", output }).errorText).toBe(
      undefined,
    );
  });

  it("is idempotent: re-normalizing keeps the error text it already lifted", () => {
    const output = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Credit balance is too low",
    });
    const once = normalizeAgentStatus({ phase: "Failed", output });

    expect(normalizeAgentStatus(once)).toEqual(once);
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

  it("audits a fallback delivery as review_post_degraded while still reporting posted", async () => {
    const p = ports();
    const comments: Array<{ number: number; body: string }> = [];
    const rejectingInline: ReviewPoster = {
      createReview: async () => {
        throw new Error("Validation Failed");
      },
      comment: async (number, body) => {
        comments.push({ number, body });
      },
      getDiff: async () => "",
    };

    const outcome = await postReviewFromNode(
      row(),
      reviewNode,
      findingsText("changes_requested"),
      { poster: rejectingInline, audit: p.audit },
    );

    expect(outcome).toBe("posted");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("boom");
    expect(p.entries).toMatchObject([
      {
        event_type: "review_post_degraded",
        repo: "re-cinq/lore",
        payload: {
          pr_number: 841,
          assembly_run_id: "line-1",
          error: "Validation Failed",
        },
      },
    ]);
  });

  it("audits a total post failure (inline post and fallback comment both throw) instead of swallowing it", async () => {
    const p = ports();
    const failing: ReviewPoster = {
      createReview: async () => {
        throw new Error("Resource not accessible by integration");
      },
      comment: async () => {
        throw new Error("Resource not accessible by integration");
      },
      getDiff: async () => "",
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
      comment: async () => {
        throw new Error("boom");
      },
      getDiff: async () => "",
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

describe("postReplyFromNode", () => {
  it("posts the reply in-thread when the line carries in_reply_to_id", async () => {
    const p = replyPorts();

    const outcome = await postReplyFromNode(
      row({ pr_number: 841, in_reply_to_id: 55 }),
      refineNode,
      replyText("Done — pushed a1b2c3d."),
      p,
    );

    expect(outcome).toBe("posted");
    expect(p.replies).toEqual([
      { number: 841, commentId: 55, body: "Done — pushed a1b2c3d." },
    ]);
    expect(p.comments).toHaveLength(0);
  });

  it("falls back to a plain PR comment when no thread id is present", async () => {
    const p = replyPorts();

    await postReplyFromNode(
      row({ pr_number: 841 }),
      refineNode,
      replyText("Answered."),
      p,
    );

    expect(p.replies).toHaveLength(0);
    expect(p.comments).toEqual([{ number: 841, body: "Answered." }]);
  });

  it("posts nothing for a node that is not a refine node", async () => {
    const p = replyPorts();

    const outcome = await postReplyFromNode(
      row(),
      reviewNode,
      replyText("nope"),
      p,
    );

    expect(outcome).toBe("not_reply");
    expect(p.replies).toHaveLength(0);
    expect(p.comments).toHaveLength(0);
  });

  it("audits a refine node that emitted no reply block", async () => {
    const p = replyPorts();

    const outcome = await postReplyFromNode(
      row({ pr_number: 841, in_reply_to_id: 55 }),
      refineNode,
      "REVIEW_RESULT:APPROVED",
      p,
    );

    expect(outcome).toBe("no_reply");
    expect(p.replies).toHaveLength(0);
    expect(p.entries).toMatchObject([
      {
        event_type: "review_reply_unparsed",
        repo: "re-cinq/lore",
        payload: { pr_number: 841 },
      },
    ]);
  });

  it("audits a reply post that throws instead of swallowing it", async () => {
    const p = replyPorts();
    const failing: ReplyPoster = {
      replyToReviewComment: async () => {
        throw new Error("Not Found");
      },
      comment: async () => {},
    };

    const outcome = await postReplyFromNode(
      row({ pr_number: 841, in_reply_to_id: 55 }),
      refineNode,
      replyText("boom"),
      { poster: failing, audit: p.audit },
    );

    expect(outcome).toBe("post_failed");
    expect(p.entries).toMatchObject([
      {
        event_type: "review_reply_post_failed",
        repo: "re-cinq/lore",
        payload: { pr_number: 841, error: "Not Found" },
      },
    ]);
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

  it("fails the node when the verdict says changes_requested and nothing was posted", () => {
    // The #1401 shape: the model emitted a REVIEW_FINDINGS block whose `body`
    // carried unescaped quotes, so JSON.parse died and nothing reached the PR —
    // while REVIEW_RESULT parsed fine. A review that reached a non-approving
    // verdict and published nothing has not approved anything.
    const result = reviewNodeResultOverride(
      "no_findings",
      "```REVIEW_FINDINGS\n{ bad json }\n```\nREVIEW_RESULT:CHANGES_REQUESTED:doc mismatch",
      { outcome: "success" },
    );

    expect(result).toEqual({ outcome: "failed" });
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

describe("postReviewFromNode dedupe (#870)", () => {
  const marker = "<!-- lore-review-run: line-1/review/1 -->";

  function probingPorts(reviewBodies: string[], commentBodies: string[]) {
    const p = ports();
    const poster: ReviewPoster = {
      ...p.poster,
      listReviews: async () =>
        reviewBodies.map((body) => ({
          id: 1,
          state: "COMMENTED",
          body,
          user: "lore-agent[bot]",
          submitted_at: "2026-07-30T00:00:00Z",
        })),
      listIssueComments: async () =>
        commentBodies.map((body) => ({
          body,
          user: "lore-agent[bot]",
          created_at: "2026-07-30T00:00:00Z",
        })),
    };

    return { ...p, poster };
  }

  it("skips the post and audits review_post_deduped when this run's marker is already in a review", async () => {
    const p = probingPorts([`### Lore review — Approved\n\n${marker}`], []);

    const outcome = await postReviewFromNode(
      row(),
      reviewNode,
      findingsText("changes_requested"),
      { ...p, iteration: 1 },
    );

    expect(outcome).toBe("already_posted");
    expect(p.reviews).toHaveLength(0);
    expect(p.entries).toMatchObject([
      {
        event_type: "review_post_deduped",
        repo: "re-cinq/lore",
        payload: { pr_number: 841, assembly_run_id: "line-1", marker },
      },
    ]);
  });

  it("skips the post when the marker rode a fallback comment instead of a review", async () => {
    const p = probingPorts([], [`fallback review\n\n${marker}`]);

    const outcome = await postReviewFromNode(
      row(),
      reviewNode,
      findingsText("approved"),
      { ...p, iteration: 1 },
    );

    expect(outcome).toBe("already_posted");
    expect(p.reviews).toHaveLength(0);
  });

  it("posts a marker-stamped review when the PR carries only another run's marker", async () => {
    const p = probingPorts(
      ["### Lore review\n\n<!-- lore-review-run: line-0/review/1 -->"],
      [],
    );

    const outcome = await postReviewFromNode(
      row(),
      reviewNode,
      findingsText("changes_requested"),
      { ...p, iteration: 1 },
    );

    expect(outcome).toBe("posted");
    expect(p.reviews).toHaveLength(1);
    expect(p.reviews[0]?.input.body).toContain(marker);
  });

  it("keys the marker on the iteration so a revisited review node still posts", async () => {
    const p = probingPorts([`### Lore review\n\n${marker}`], []);

    const outcome = await postReviewFromNode(
      row(),
      reviewNode,
      findingsText("changes_requested"),
      { ...p, iteration: 2 },
    );

    expect(outcome).toBe("posted");
    expect(p.reviews[0]?.input.body).toContain(
      "<!-- lore-review-run: line-1/review/2 -->",
    );
  });

  it("posts anyway when the probe throws (fail-open, never drop the review)", async () => {
    const p = ports();
    const poster: ReviewPoster = {
      ...p.poster,
      listReviews: async () => {
        throw new Error("API rate limited");
      },
      listIssueComments: async () => [],
    };

    const outcome = await postReviewFromNode(
      row(),
      reviewNode,
      findingsText("approved"),
      { ...p, poster, iteration: 1 },
    );

    expect(outcome).toBe("posted");
    expect(p.reviews).toHaveLength(1);
  });
});

describe("reviewNodeResultOverride on a deduped post", () => {
  it("keeps the result when the review was already posted by the first delivery", () => {
    const result = reviewNodeResultOverride("already_posted", undefined, {
      outcome: "changes_requested",
    });

    expect(result).toEqual({ outcome: "changes_requested" });
  });
});

describe("postReviewFromNode without a known iteration", () => {
  it("skips probe and marker and posts anyway when the iteration is unknown", async () => {
    const p = ports();
    const poster: ReviewPoster = {
      ...p.poster,
      listReviews: async () => [
        {
          id: 1,
          state: "COMMENTED",
          body: "### Lore review\n\n<!-- lore-review-run: line-1/review/1 -->",
          user: "lore-agent[bot]",
          submitted_at: "2026-07-30T00:00:00Z",
        },
      ],
      listIssueComments: async () => [],
    };

    const outcome = await postReviewFromNode(
      row(),
      reviewNode,
      findingsText("changes_requested"),
      { ...p, poster },
    );

    expect(outcome).toBe("posted");
    expect(p.reviews).toHaveLength(1);
    expect(p.reviews[0]?.input.body).not.toContain("lore-review-run");
  });
});

describe("postReplyFromNode dedupe (#1004)", () => {
  const marker = "<!-- lore-reply-run: line-1/reply/1 -->";

  function probingReplyPorts(threadBodies: string[], commentBodies: string[]) {
    const p = replyPorts();
    const poster: ReplyPoster = {
      ...p.poster,
      listComments: async () =>
        threadBodies.map((body, i) => ({
          id: i + 1,
          path: "a.ts",
          line: 1,
          body,
          user: "lore-agent[bot]",
          created_at: "2026-07-31T00:00:00Z",
        })),
      listIssueComments: async () =>
        commentBodies.map((body) => ({
          body,
          user: "lore-agent[bot]",
          created_at: "2026-07-31T00:00:00Z",
        })),
    };

    return { ...p, poster };
  }

  it("skips the in-thread post and audits review_reply_post_deduped when this run's marker is already in the thread", async () => {
    const p = probingReplyPorts([`${marker}\n\nDone — pushed a1b2c3d.`], []);

    const outcome = await postReplyFromNode(
      row({ pr_number: 841, in_reply_to_id: 55 }),
      refineNode,
      replyText("Done — pushed a1b2c3d."),
      { ...p, iteration: 1 },
    );

    expect(outcome).toBe("already_posted");
    expect(p.replies).toHaveLength(0);
    expect(p.comments).toHaveLength(0);
    expect(p.entries).toMatchObject([
      {
        event_type: "review_reply_post_deduped",
        repo: "re-cinq/lore",
        payload: { pr_number: 841, assembly_run_id: "line-1", marker },
      },
    ]);
  });

  it("skips the post when the marker rode a plain PR comment (fallback delivery)", async () => {
    const p = probingReplyPorts([], [`${marker}\n\nAnswered.`]);

    const outcome = await postReplyFromNode(
      row({ pr_number: 841 }),
      refineNode,
      replyText("Answered."),
      { ...p, iteration: 1 },
    );

    expect(outcome).toBe("already_posted");
    expect(p.comments).toHaveLength(0);
  });

  it("posts a reply with the marker leading the body when the PR carries only another run's marker", async () => {
    const p = probingReplyPorts(
      ["<!-- lore-reply-run: line-0/reply/1 -->\n\nDone."],
      [],
    );

    const outcome = await postReplyFromNode(
      row({ pr_number: 841, in_reply_to_id: 55 }),
      refineNode,
      replyText("Done — pushed a1b2c3d."),
      { ...p, iteration: 1 },
    );

    expect(outcome).toBe("posted");
    expect(p.replies).toEqual([
      {
        number: 841,
        commentId: 55,
        body: `${marker}\n\nDone — pushed a1b2c3d.`,
      },
    ]);
  });

  it("keys the marker on the iteration so a revisited refine node still posts", async () => {
    const p = probingReplyPorts([`${marker}\n\nDone.`], []);

    const outcome = await postReplyFromNode(
      row({ pr_number: 841, in_reply_to_id: 55 }),
      refineNode,
      replyText("Round two."),
      { ...p, iteration: 2 },
    );

    expect(outcome).toBe("posted");
    expect(p.replies[0]?.body).toContain(
      "<!-- lore-reply-run: line-1/reply/2 -->",
    );
  });

  it("posts anyway when the probe throws (fail-open, never drop the reply)", async () => {
    const p = replyPorts();
    const poster: ReplyPoster = {
      ...p.poster,
      listComments: async () => {
        throw new Error("API rate limited");
      },
      listIssueComments: async () => [],
    };

    const outcome = await postReplyFromNode(
      row({ pr_number: 841, in_reply_to_id: 55 }),
      refineNode,
      replyText("Still here."),
      { ...p, poster, iteration: 1 },
    );

    expect(outcome).toBe("posted");
    expect(p.replies).toHaveLength(1);
  });

  it("leads the comment with the marker so an adapter-filtered opening prefix cannot hide it from the probe", async () => {
    const p = probingReplyPorts([], []);

    await postReplyFromNode(
      row({ pr_number: 841 }),
      refineNode,
      replyText("Agent run finished; no code change needed."),
      { ...p, iteration: 1 },
    );

    expect(p.comments[0]?.body).toMatch(/^<!-- lore-reply-run/);
    expect(p.comments[0]?.body).toContain("Agent run finished");
  });
});

describe("postReplyFromNode without the probe surface", () => {
  it("stamps the marker but skips the probe when the poster has no read surface", async () => {
    const p = replyPorts();

    const outcome = await postReplyFromNode(
      row({ pr_number: 841, in_reply_to_id: 55 }),
      refineNode,
      replyText("Done."),
      { ...p, iteration: 1 },
    );

    expect(outcome).toBe("posted");
    expect(p.replies[0]?.body).toBe(
      "<!-- lore-reply-run: line-1/reply/1 -->\n\nDone.",
    );
  });
});

describe("postReplyFromNode without a known iteration", () => {
  it("skips probe and marker and posts anyway when the iteration is unknown", async () => {
    const p = probingUnknownIteration();

    const outcome = await postReplyFromNode(
      row({ pr_number: 841, in_reply_to_id: 55 }),
      refineNode,
      replyText("Done."),
      p,
    );

    expect(outcome).toBe("posted");
    expect(p.replies[0]?.body).toBe("Done.");
  });

  function probingUnknownIteration() {
    const p = replyPorts();
    const poster: ReplyPoster = {
      ...p.poster,
      listComments: async () => [
        {
          id: 1,
          path: "a.ts",
          line: 1,
          body: "<!-- lore-reply-run: line-1/reply/1 -->\n\nDone.",
          user: "lore-agent[bot]",
          created_at: "2026-07-31T00:00:00Z",
        },
      ],
      listIssueComments: async () => [],
    };

    return { ...p, poster };
  }
});

describe("postReviewFromNode for the fast re-check node", () => {
  const recheckNode: RunGraphNode = {
    station: null,
    station_inherited: false,
    id: "recheck",
    type: "agent",
    prompt_ref: "code-review-recheck",
  };

  it("submits a REQUEST_CHANGES review for a re-check node that requests changes", async () => {
    const p = ports();

    const outcome = await postReviewFromNode(
      row(),
      recheckNode,
      findingsText("changes_requested"),
      p,
    );

    expect(outcome).toBe("posted");
    expect(p.reviews[0]?.input.event).toBe("REQUEST_CHANGES");
  });

  it("submits an APPROVE review for a re-check node that approves", async () => {
    const p = ports();

    const outcome = await postReviewFromNode(
      row(),
      recheckNode,
      findingsText("approved"),
      p,
    );

    expect(outcome).toBe("posted");
    expect(p.reviews[0]?.input.event).toBe("APPROVE");
  });
});
