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
        hasCiHistory: true,
      }),
    ).toEqual({ kind: "wait", reason: "ci_pending" });
  });

  it("blocks immediately on red CI without waiting for the review round-trip", () => {
    expect(
      decidePrReady({
        ci: "failure",
        threads: [],
        openReviewRunCount: 3,
        hasCiHistory: true,
      }),
    ).toEqual({ kind: "blocked", reason: "ci_red" });
  });

  it("is ready on green CI with zero unresolved threads", () => {
    expect(
      decidePrReady({
        ci: "success",
        threads: [thread({ isResolved: true }), thread({ isOutdated: true })],
        openReviewRunCount: 0,
        hasCiHistory: true,
      }),
    ).toEqual({ kind: "ready" });
  });

  it("treats a repo with no checks configured as green", () => {
    expect(
      decidePrReady({
        ci: "none",
        threads: [],
        openReviewRunCount: 0,
        hasCiHistory: false,
      }),
    ).toEqual({ kind: "ready" });
  });

  it("waits when a repo that runs CI reports no checks yet", () => {
    // The window between a push and GitHub registering the first check run for
    // the new head sha. `none` there is "not started", not "nothing to run" —
    // reading it as green resumed the line on a build nobody had verified.
    expect(
      decidePrReady({
        ci: "none",
        threads: [],
        openReviewRunCount: 0,
        hasCiHistory: true,
      }),
    ).toEqual({ kind: "wait", reason: "ci_not_started" });
  });

  it("waits on unresolved threads while a review-family run is still open", () => {
    expect(
      decidePrReady({
        ci: "success",
        threads: [thread()],
        openReviewRunCount: 1,
        hasCiHistory: true,
      }),
    ).toEqual({ kind: "wait", reason: "address_in_flight" });
  });

  it("blocks on unresolved threads once no review-family run is open", () => {
    expect(
      decidePrReady({
        ci: "success",
        threads: [thread()],
        openReviewRunCount: 0,
        hasCiHistory: true,
      }),
    ).toEqual({ kind: "blocked", reason: "unresolved_threads" });
  });
});

describe("decidePrReady with no checks configured", () => {
  it("blocks on unresolved threads even when ci is none — green covers only the CI half", () => {
    expect(
      decidePrReady({
        ci: "none",
        threads: [thread()],
        openReviewRunCount: 0,
        hasCiHistory: false,
      }),
    ).toEqual({ kind: "blocked", reason: "unresolved_threads" });
  });
});
