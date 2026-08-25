import { describe, expect, it } from "vitest";
import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { decidePrReady } from "./decide-ready.js";

const thread = (over: Partial<ReviewThread> = {}): ReviewThread => ({
  id: "PRRT_1",
  isResolved: false,
  isOutdated: false,
  comments: [{ databaseId: 1 }],
  ...over,
});

describe("decidePrReady", () => {
  it("waits while CI is pending, whatever the threads say", () => {
    expect(
      decidePrReady({
        ci: "pending",
        threads: [thread()],
        openReviewRunCount: 0,
      }),
    ).toEqual({ kind: "wait", reason: "ci_pending" });
  });

  it("blocks immediately on red CI without waiting for the review round-trip", () => {
    expect(
      decidePrReady({ ci: "failure", threads: [], openReviewRunCount: 3 }),
    ).toEqual({ kind: "blocked", reason: "ci_red" });
  });

  it("is ready on green CI with zero unresolved threads", () => {
    expect(
      decidePrReady({
        ci: "success",
        threads: [thread({ isResolved: true }), thread({ isOutdated: true })],
        openReviewRunCount: 0,
      }),
    ).toEqual({ kind: "ready" });
  });

  it("treats a repo with no checks configured as green", () => {
    expect(
      decidePrReady({ ci: "none", threads: [], openReviewRunCount: 0 }),
    ).toEqual({ kind: "ready" });
  });

  it("waits on unresolved threads while a review-family run is still open", () => {
    expect(
      decidePrReady({
        ci: "success",
        threads: [thread()],
        openReviewRunCount: 1,
      }),
    ).toEqual({ kind: "wait", reason: "address_in_flight" });
  });

  it("blocks on unresolved threads once no review-family run is open", () => {
    expect(
      decidePrReady({
        ci: "success",
        threads: [thread()],
        openReviewRunCount: 0,
      }),
    ).toEqual({ kind: "blocked", reason: "unresolved_threads" });
  });
});
