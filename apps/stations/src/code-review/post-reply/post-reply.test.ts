import { describe, expect, it } from "vitest";
import type { ReviewComment } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  postReply,
  replyMarker,
  stampedReply,
  stampedThreadReply,
  threadReplyMarker,
  type ReplyDelivery,
  type ReplyPoster,
} from "./post-reply.js";

function reviewComment(overrides: Partial<ReviewComment>): ReviewComment {
  return {
    id: 1,
    path: "src/a.ts",
    line: 1,
    body: "",
    user: "alice",
    created_at: "2026-09-30T10:00:00Z",
    review_id: 99,
    in_reply_to_id: null,
    ...overrides,
  };
}

const REVIEW_99 = [
  reviewComment({ id: 88, body: "Rename this." }),
  reviewComment({ id: 89, body: "Why does this retry?" }),
];

interface Recorded {
  replies: { prNumber: number; commentId: number; body: string }[];
  comments: { prNumber: number; body: string }[];
  resolved: string[];
}

interface Existing {
  reviewComments?: ReviewComment[];
  issueBodies?: string[];
  refusedCommentIds?: number[];
}

function fakePoster(existing: Existing = {}) {
  const recorded: Recorded = { replies: [], comments: [], resolved: [] };
  const poster: ReplyPoster = {
    replyToReviewComment: async (prNumber, commentId, body) => {
      if (existing.refusedCommentIds?.includes(commentId)) {
        throw new Error("404 Not Found");
      }
      recorded.replies.push({ prNumber, commentId, body });
    },
    comment: async (prNumber, body) => {
      recorded.comments.push({ prNumber, body });
    },
    listComments: async () => existing.reviewComments ?? REVIEW_99,
    listIssueComments: async () =>
      (existing.issueBodies ?? []).map((body) => ({
        user: "alice",
        created_at: "2026-09-30T10:00:00Z",
        body,
      })),
    listReviewThreads: async () => [
      thread("T1", [88]),
      thread("T2", [89]),
      thread("T3", [70, 91]),
    ],
    resolveReviewThread: async (threadId) => {
      recorded.resolved.push(threadId);
    },
  };

  return { poster, recorded };
}

function thread(id: string, commentIds: number[]) {
  return {
    id,
    isResolved: false,
    isOutdated: false,
    comments: commentIds.map((databaseId) => ({ databaseId })),
  };
}

function outputOf(threadReplies: object[]): string {
  return [
    "chatter",
    "```REVIEW_REPLY\nDone, renamed.\n```",
    `\`\`\`REVIEW_THREAD_REPLIES\n${JSON.stringify(threadReplies)}\n\`\`\``,
  ].join("\n");
}

function deliveryOf(
  poster: ReplyPoster,
  overrides: Partial<ReplyDelivery> = {},
): ReplyDelivery {
  return {
    poster,
    prNumber: 412,
    visitId: "v-7",
    iteration: 2,
    replyOutput: "chatter\n```REVIEW_REPLY\nDone, renamed.\n```\n",
    reviewId: 99,
    ...overrides,
  };
}

const VISIT = { visitId: "v-7", iteration: 2 };
const stampedDone = stampedReply("Done, renamed.", "v-7", 2);
const RENAMED = { comment_id: 88, reply: "Renamed in a1b2c3d.", resolved: true };
const RETRIES = { comment_id: 89, reply: "It retries once, see retry.ts." };

describe("postReply", () => {
  it("comments on PR 412 with the stamped reply when the agent answered no line comment", async () => {
    const { poster, recorded } = fakePoster();

    const outcome = await postReply(deliveryOf(poster));

    expect({ outcome, recorded }).toEqual({
      outcome: "posted",
      recorded: {
        replies: [],
        comments: [{ prNumber: 412, body: stampedDone }],
        resolved: [],
      },
    });
  });

  it("replies under comments 88 and 89 of review 99 and resolves only T1, the thread of the reply marked resolved", async () => {
    const { poster, recorded } = fakePoster();

    await postReply(
      deliveryOf(poster, { replyOutput: outputOf([RENAMED, RETRIES]) }),
    );

    expect(recorded).toEqual({
      replies: [
        {
          prNumber: 412,
          commentId: 88,
          body: stampedThreadReply("Renamed in a1b2c3d.", VISIT, 88),
        },
        {
          prNumber: 412,
          commentId: 89,
          body: stampedThreadReply("It retries once, see retry.ts.", VISIT, 89),
        },
      ],
      comments: [{ prNumber: 412, body: stampedDone }],
      resolved: ["T1"],
    });
  });

  it("replies against comment 70, which opened the thread, when comment 91 of review 99 is itself a reply", async () => {
    const { poster, recorded } = fakePoster({
      reviewComments: [reviewComment({ id: 91, in_reply_to_id: 70 })],
    });

    await postReply(
      deliveryOf(poster, {
        replyOutput: outputOf([
          { comment_id: 91, reply: "Guarded now.", resolved: true },
        ]),
      }),
    );

    expect({
      repliedTo: recorded.replies.map((reply) => reply.commentId),
      resolved: recorded.resolved,
    }).toEqual({ repliedTo: [70], resolved: ["T3"] });
  });

  it("moves a reply to comment 7, which is not in review 99, into the comment on the pull request", async () => {
    const { poster, recorded } = fakePoster({
      reviewComments: [...REVIEW_99, reviewComment({ id: 7, review_id: 12 })],
    });

    await postReply(
      deliveryOf(poster, {
        replyOutput: outputOf([{ comment_id: 7, reply: "Also fixed." }]),
      }),
    );

    expect(recorded).toEqual({
      replies: [],
      comments: [
        {
          prNumber: 412,
          body: stampedReply(
            "Done, renamed.\n\nAnswers that could not be posted in their thread:\n- comment 7: Also fixed.",
            "v-7",
            2,
          ),
        },
      ],
      resolved: [],
    });
  });

  it("moves the reply to comment 88 into the comment on the pull request when GitHub refuses it, and leaves T1 open", async () => {
    const { poster, recorded } = fakePoster({ refusedCommentIds: [88] });

    await postReply(deliveryOf(poster, { replyOutput: outputOf([RENAMED]) }));

    expect(recorded).toEqual({
      replies: [],
      comments: [
        {
          prNumber: 412,
          body: stampedReply(
            "Done, renamed.\n\nAnswers that could not be posted in their thread:\n- comment 88: Renamed in a1b2c3d.",
            "v-7",
            2,
          ),
        },
      ],
      resolved: [],
    });
  });

  it("posts only the reply to comment 89 and the comment when the thread of comment 88 already carries marker v-7/2/88, and still resolves T1", async () => {
    const { poster, recorded } = fakePoster({
      reviewComments: [
        ...REVIEW_99,
        reviewComment({
          id: 120,
          review_id: null,
          in_reply_to_id: 88,
          body: `Renamed.\n${threadReplyMarker(VISIT, 88)}`,
        }),
      ],
    });

    const outcome = await postReply(
      deliveryOf(poster, { replyOutput: outputOf([RENAMED, RETRIES]) }),
    );

    expect({
      outcome,
      repliedTo: recorded.replies.map((reply) => reply.commentId),
      comments: recorded.comments.length,
      resolved: recorded.resolved,
    }).toEqual({
      outcome: "posted",
      repliedTo: [89],
      comments: 1,
      resolved: ["T1"],
    });
  });

  it("skips posting when a PR comment carries marker v-7/2", async () => {
    const { poster, recorded } = fakePoster({
      issueBodies: [replyMarker("v-7", 2)],
    });

    const outcome = await postReply(deliveryOf(poster));

    expect({ outcome, comments: recorded.comments }).toEqual({
      outcome: "already_posted",
      comments: [],
    });
  });

  it("posts again when the existing marker is for iteration 1", async () => {
    const { poster, recorded } = fakePoster({
      issueBodies: [replyMarker("v-7", 1)],
    });

    const outcome = await postReply(deliveryOf(poster));

    expect({ outcome, posted: recorded.comments.length }).toEqual({
      outcome: "posted",
      posted: 1,
    });
  });

  it("posts every thread reply on the pull request when the run carries no review id", async () => {
    const { poster, recorded } = fakePoster();

    await postReply(
      deliveryOf(poster, { reviewId: null, replyOutput: outputOf([RETRIES]) }),
    );

    expect({
      replies: recorded.replies,
      comment: recorded.comments[0].body,
    }).toEqual({
      replies: [],
      comment: stampedReply(
        "Done, renamed.\n\nAnswers that could not be posted in their thread:\n- comment 89: It retries once, see retry.ts.",
        "v-7",
        2,
      ),
    });
  });

  it("throws when the output has no REVIEW_REPLY block", async () => {
    const { poster } = fakePoster();

    await expect(
      postReply(deliveryOf(poster, { replyOutput: "nothing fenced" })),
    ).rejects.toThrow(new Error("reply output carries no REVIEW_REPLY block"));
  });
});

describe("stampedReply", () => {
  it("ends the body with the identity line and then the hidden marker", () => {
    expect(stampedReply("Done.", "v-7", 2)).toBe(
      "Done.\n\n_Posted by floor, visit v-7._\n\n<!-- lore-reply-run: v-7/2 -->",
    );
  });
});

describe("stampedThreadReply", () => {
  it("ends a reply to comment 88 with a marker that names the comment, so each thread is posted once", () => {
    expect(stampedThreadReply("Renamed.", VISIT, 88)).toBe(
      "Renamed.\n\n_Posted by floor, visit v-7._\n\n<!-- lore-reply-run: v-7/2/88 -->",
    );
  });
});
