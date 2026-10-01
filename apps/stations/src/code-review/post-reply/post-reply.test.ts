import { describe, expect, it } from "vitest";
import type { ReviewComment } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  postReply,
  replyMarker,
  stampedReply,
  type ReplyDelivery,
  type ReplyPoster,
} from "./post-reply.js";

const baseComment: ReviewComment = {
  id: 1,
  path: "src/a.ts",
  line: 1,
  body: "",
  user: "alice",
  created_at: "2026-09-30T10:00:00Z",
};

interface Recorded {
  replies: { prNumber: number; commentId: number; body: string }[];
  comments: { prNumber: number; body: string }[];
  resolved: string[];
}

function fakePoster(
  existing: { threadBodies?: string[]; issueBodies?: string[] } = {},
) {
  const recorded: Recorded = { replies: [], comments: [], resolved: [] };
  const poster: ReplyPoster = {
    replyToReviewComment: async (prNumber, commentId, body) => {
      recorded.replies.push({ prNumber, commentId, body });
    },
    comment: async (prNumber, body) => {
      recorded.comments.push({ prNumber, body });
    },
    listComments: async () =>
      (existing.threadBodies ?? []).map((body) => ({ ...baseComment, body })),
    listIssueComments: async () =>
      (existing.issueBodies ?? []).map((body) => ({
        user: "alice",
        created_at: "2026-09-30T10:00:00Z",
        body,
      })),
    listReviewThreads: async () => [
      {
        id: "T1",
        isResolved: false,
        isOutdated: false,
        comments: [{ databaseId: 88 }],
      },
    ],
    resolveReviewThread: async (threadId) => {
      recorded.resolved.push(threadId);
    },
  };

  return { poster, recorded };
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
    commentId: 0,
    intent: "address",
    ...overrides,
  };
}

const stampedDone = stampedReply("Done, renamed.", "v-7", 2);

describe("postReply", () => {
  it("comments on PR 412 with the stamped reply when comment_id is 0", async () => {
    const { poster, recorded } = fakePoster();

    const outcome = await postReply(deliveryOf(poster));

    expect({ outcome, comments: recorded.comments }).toEqual({
      outcome: "posted",
      comments: [{ prNumber: 412, body: stampedDone }],
    });
  });

  it("replies in thread of comment 88 and resolves thread T1 when intent is address", async () => {
    const { poster, recorded } = fakePoster();

    await postReply(deliveryOf(poster, { commentId: 88 }));

    expect(recorded).toEqual({
      replies: [{ prNumber: 412, commentId: 88, body: stampedDone }],
      comments: [],
      resolved: ["T1"],
    });
  });

  it("leaves thread T1 open when intent is answer", async () => {
    const { poster, recorded } = fakePoster();

    await postReply(deliveryOf(poster, { commentId: 88, intent: "answer" }));

    expect(recorded.resolved).toEqual([]);
  });

  it("skips posting when a thread comment carries marker v-7/2", async () => {
    const { poster, recorded } = fakePoster({
      threadBodies: [`old\n${replyMarker("v-7", 2)}`],
    });

    const outcome = await postReply(deliveryOf(poster));

    expect({ outcome, comments: recorded.comments }).toEqual({
      outcome: "already_posted",
      comments: [],
    });
  });

  it("skips posting when a PR comment carries marker v-7/2", async () => {
    const { poster, recorded } = fakePoster({
      issueBodies: [replyMarker("v-7", 2)],
    });

    const outcome = await postReply(deliveryOf(poster, { commentId: 88 }));

    expect({ outcome, replies: recorded.replies }).toEqual({
      outcome: "already_posted",
      replies: [],
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
