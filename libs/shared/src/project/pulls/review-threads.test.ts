import { describe, expect, it } from "vitest";
import type { ReviewThread } from "./pull-requests-port.js";
import { findThreadForComment } from "./review-threads.js";

const thread = (id: string, ids: Array<number | null>): ReviewThread => ({
  id,
  isResolved: false,
  isOutdated: false,
  comments: ids.map((databaseId) => ({ databaseId })),
});

describe("findThreadForComment", () => {
  it("returns the thread whose comments carry the REST comment id", () => {
    const threads = [thread("PRRT_1", [10, 11]), thread("PRRT_2", [20, 21])];

    expect(findThreadForComment(threads, 21)?.id).toBe("PRRT_2");
  });

  it("returns null when no thread carries the comment id", () => {
    expect(findThreadForComment([thread("PRRT_1", [10])], 999)).toBeNull();
  });

  it("never matches on a null databaseId", () => {
    const threads = [thread("PRRT_1", [null])];

    expect(findThreadForComment(threads, 0)).toBeNull();
  });
});
