import { describe, expect, it } from "vitest";
import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  resolveRepliedThread,
  type ThreadResolver,
} from "./reply-thread-resolve.js";

function thread(id: string, commentId: number): ReviewThread {
  return {
    id,
    isResolved: false,
    isOutdated: false,
    comments: [{ databaseId: commentId }],
  };
}

function fakeResolver(threads: ReviewThread[] | Error) {
  const resolvedIds: string[] = [];
  const resolver: ThreadResolver = {
    listReviewThreads: async () => {
      if (threads instanceof Error) {
        throw threads;
      }

      return threads;
    },
    resolveReviewThread: async (threadId) => {
      resolvedIds.push(threadId);
    },
  };

  return { resolver, resolvedIds };
}

describe("resolveRepliedThread", () => {
  it("resolves thread T2 when intent is address and comment 20 sits in T2", async () => {
    const { resolver, resolvedIds } = fakeResolver([
      thread("T1", 10),
      thread("T2", 20),
    ]);

    await resolveRepliedThread(
      resolver,
      { prNumber: 4, commentId: 20 },
      "address",
    );

    expect(resolvedIds).toEqual(["T2"]);
  });

  it("leaves the thread open when intent is answer", async () => {
    const { resolver, resolvedIds } = fakeResolver([thread("T2", 20)]);

    await resolveRepliedThread(
      resolver,
      { prNumber: 4, commentId: 20 },
      "answer",
    );

    expect(resolvedIds).toEqual([]);
  });

  it("resolves nothing when comment 99 is in no thread", async () => {
    const { resolver, resolvedIds } = fakeResolver([thread("T2", 20)]);

    await resolveRepliedThread(
      resolver,
      { prNumber: 4, commentId: 99 },
      "address",
    );

    expect(resolvedIds).toEqual([]);
  });

  it("resolves nothing when thread T2 is already resolved", async () => {
    const { resolver, resolvedIds } = fakeResolver([
      { ...thread("T2", 20), isResolved: true },
    ]);

    await resolveRepliedThread(
      resolver,
      { prNumber: 4, commentId: 20 },
      "address",
    );

    expect(resolvedIds).toEqual([]);
  });

  it("does not throw when listing threads fails with 502", async () => {
    const { resolver } = fakeResolver(new Error("502"));

    await expect(
      resolveRepliedThread(resolver, { prNumber: 4, commentId: 20 }, "address"),
    ).resolves.toBeUndefined();
  });
});
