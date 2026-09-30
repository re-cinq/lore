import { describe, expect, it } from "vitest";
import type { Brief, Tools } from "@re-cinq/floor-station";
import { postReplyHandle } from "./station.js";
import { stampedReply, type ReplyPoster } from "./post-reply.js";

function toolsReading(replyOutput: string): Tools {
  return {
    read: async () => Buffer.from(replyOutput),
    produce: async () => undefined,
    modelCall: async () => undefined,
    signal: new AbortController().signal,
  };
}

function fakePoster() {
  const comments: { prNumber: number; body: string }[] = [];
  const replies: { commentId: number; body: string }[] = [];
  const poster: ReplyPoster = {
    replyToReviewComment: async (_prNumber, commentId, body) => {
      replies.push({ commentId, body });
    },
    comment: async (prNumber, body) => {
      comments.push({ prNumber, body });
    },
    listComments: async () => [],
    listIssueComments: async () => [],
    listReviewThreads: async () => [],
    resolveReviewThread: async () => undefined,
  };

  return { poster, comments, replies };
}

const prUrl = "https://github.com/re-cinq/lore/pull/412";
const replyOutput = "```REVIEW_REPLY\nFixed.\n```";

function briefOf(needs: Record<string, string>): Brief {
  return { visitId: "v-9", iteration: 1, needs: { pr_url: prUrl, ...needs } };
}

describe("postReplyHandle", () => {
  it("comments on PR 412 and produces reply_url when comment_id is absent", async () => {
    const { poster, comments } = fakePoster();
    const requestedRepos: string[] = [];
    const handle = postReplyHandle({
      poster: async (repo) => {
        requestedRepos.push(repo);

        return poster;
      },
    });

    const report = await handle(briefOf({}), toolsReading(replyOutput));

    expect({ report, comments, requestedRepos }).toEqual({
      report: { outcome: "success", produced: { reply_url: prUrl } },
      comments: [{ prNumber: 412, body: stampedReply("Fixed.", "v-9", 1) }],
      requestedRepos: ["re-cinq/lore"],
    });
  });

  it("replies in the thread of comment 88 when comment_id is 88", async () => {
    const { poster, replies } = fakePoster();
    const handle = postReplyHandle({ poster: async () => poster });

    await handle(briefOf({ comment_id: "88" }), toolsReading(replyOutput));

    expect(replies).toEqual([
      { commentId: 88, body: stampedReply("Fixed.", "v-9", 1) },
    ]);
  });

  it("rejects when the agent output has no REVIEW_REPLY block", async () => {
    const { poster } = fakePoster();
    const handle = postReplyHandle({ poster: async () => poster });

    await expect(handle(briefOf({}), toolsReading("no block"))).rejects.toThrow(
      new Error("reply output carries no REVIEW_REPLY block"),
    );
  });
});
