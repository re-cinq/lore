import { describe, expect, it } from "vitest";
import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  resolveRepliedThreads,
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
  const listings: number[] = [];
  const resolver: ThreadResolver = {
    listReviewThreads: async (prNumber) => {
      listings.push(prNumber);

      if (threads instanceof Error) {
        throw threads;
      }

      return threads;
    },
    resolveReviewThread: async (threadId) => {
      resolvedIds.push(threadId);
    },
  };

  return { resolver, resolvedIds, listings };
}

describe("resolveRepliedThreads", () => {
  it("resolves thread T2 when comment 20 sits in T2", async () => {
    const { resolver, resolvedIds } = fakeResolver([
      thread("T1", 10),
      thread("T2", 20),
    ]);

    await resolveRepliedThreads(resolver, 4, [20]);

    expect(resolvedIds).toEqual(["T2"]);
  });

  it("resolves T1 and T2 from one listing when comments 10 and 20 were both settled", async () => {
    const { resolver, resolvedIds, listings } = fakeResolver([
      thread("T1", 10),
      thread("T2", 20),
    ]);

    await resolveRepliedThreads(resolver, 4, [10, 20]);

    expect({ resolvedIds, listings: listings.length }).toEqual({
      resolvedIds: ["T1", "T2"],
      listings: 1,
    });
  });

  it("reads no threads when no comment was settled", async () => {
    const { resolver, listings } = fakeResolver([thread("T2", 20)]);

    await resolveRepliedThreads(resolver, 4, []);

    expect(listings).toEqual([]);
  });

  it("resolves nothing when comment 99 is in no thread", async () => {
    const { resolver, resolvedIds } = fakeResolver([thread("T2", 20)]);

    await resolveRepliedThreads(resolver, 4, [99]);

    expect(resolvedIds).toEqual([]);
  });

  it("resolves nothing when thread T2 is already resolved", async () => {
    const { resolver, resolvedIds } = fakeResolver([
      { ...thread("T2", 20), isResolved: true },
    ]);

    await resolveRepliedThreads(resolver, 4, [20]);

    expect(resolvedIds).toEqual([]);
  });

  it("does not throw when listing threads fails with 502", async () => {
    const { resolver } = fakeResolver(new Error("502"));

    await expect(
      resolveRepliedThreads(resolver, 4, [20]),
    ).resolves.toBeUndefined();
  });
});
