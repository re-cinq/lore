import { describe, it, expect } from "vitest";
import {
  BLOCKED_REASON_MARKER,
  blockedReasonComment,
  syncReasonComment,
} from "./comment.js";
import { InMemoryCommentThread } from "./comment-thread-memory.js";

describe("blockedReasonComment", () => {
  it("reads Not merging yet: Conflicts with main, with the marker, for merge_conflict on main", () => {
    expect(
      blockedReasonComment({ reason: "merge_conflict", detail: "main" }),
    ).toBe(
      `Not merging yet: Conflicts with main. Lore updates this comment when the reason changes.\n\n${BLOCKED_REASON_MARKER}`,
    );
  });

  it("says nothing blocks the PR now, with the marker, when the reason is cleared", () => {
    expect(blockedReasonComment(null)).toBe(
      `Nothing blocks this PR from merging now. Lore updates this comment when the reason changes.\n\n${BLOCKED_REASON_MARKER}`,
    );
  });
});

describe("syncReasonComment", () => {
  it("posts one marker comment on #7 when none exists and a reason holds", async () => {
    const thread = new InMemoryCommentThread();

    await syncReasonComment(thread, 7, {
      reason: "waiting_on_ci",
      detail: null,
    });

    expect(thread.comments).toEqual([
      {
        number: 7,
        id: 1,
        body: blockedReasonComment({ reason: "waiting_on_ci", detail: null }),
      },
    ]);
  });

  it("edits the marker comment on #7 in place and leaves the other comment alone", async () => {
    const thread = new InMemoryCommentThread([
      { number: 7, id: 1, body: "looks good" },
      { number: 7, id: 2, body: `old reason\n\n${BLOCKED_REASON_MARKER}` },
    ]);

    await syncReasonComment(thread, 7, {
      reason: "needs_approval",
      detail: null,
    });

    expect(thread.comments).toEqual([
      { number: 7, id: 1, body: "looks good" },
      {
        number: 7,
        id: 2,
        body: blockedReasonComment({ reason: "needs_approval", detail: null }),
      },
    ]);
  });

  it("edits the marker comment on #7 to say nothing blocks once the reason clears", async () => {
    const thread = new InMemoryCommentThread([
      { number: 7, id: 2, body: `old reason\n\n${BLOCKED_REASON_MARKER}` },
    ]);

    await syncReasonComment(thread, 7, null);

    expect(thread.comments).toEqual([
      { number: 7, id: 2, body: blockedReasonComment(null) },
    ]);
  });

  it("writes nothing on #7 when the reason clears and no marker comment exists", async () => {
    const thread = new InMemoryCommentThread();

    await syncReasonComment(thread, 7, null);

    expect(thread.comments).toEqual([]);
  });
});
