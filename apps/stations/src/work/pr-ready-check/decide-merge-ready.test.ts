import { describe, expect, it } from "vitest";
import {
  decideMergeReady,
  type MergeReadyInput,
} from "./decide-merge-ready.js";

const READY: MergeReadyInput = {
  mergeable: true,
  ci: "success",
  hasCiHistory: true,
  unresolvedThreads: 0,
  openReviewRuns: 0,
  review: "approved",
  ageHours: 30,
  minAgeHours: 24,
};

const verdict = (over: Partial<MergeReadyInput>) =>
  decideMergeReady({ ...READY, ...over });

describe("decideMergeReady", () => {
  it("is ready when CI is green, no thread is open, the review approved and the PR is 30 hours old against a 24 hour minimum", () => {
    expect(verdict({})).toEqual({ kind: "ready" });
  });

  it("waits for a green, approved PR that is 2 hours old until it reaches 24", () => {
    expect([
      verdict({ ageHours: 2 }),
      verdict({ ageHours: 2, minAgeHours: 0 }),
    ]).toEqual([{ kind: "wait", reason: "too_young" }, { kind: "ready" }]);
  });

  it("waits on a conflict and on red CI, fixing neither", () => {
    expect([
      verdict({ mergeable: false, ci: "failure" }),
      verdict({ ci: "failure" }),
    ]).toEqual([
      { kind: "wait", reason: "pr_conflicting" },
      { kind: "wait", reason: "ci_red" },
    ]);
  });

  it("waits on CI still running, and on CI not started in a repo that runs checks", () => {
    expect([
      verdict({ ci: "pending" }),
      verdict({ ci: "none" }),
      verdict({ ci: "none", hasCiHistory: false }),
    ]).toEqual([
      { kind: "wait", reason: "ci_pending" },
      { kind: "wait", reason: "ci_not_started" },
      { kind: "ready" },
    ]);
  });

  it("waits on 2 open threads, naming a reply run that is already answering them", () => {
    expect([
      verdict({ unresolvedThreads: 2 }),
      verdict({ unresolvedThreads: 2, openReviewRuns: 1 }),
    ]).toEqual([
      { kind: "wait", reason: "unresolved_threads" },
      { kind: "wait", reason: "address_in_flight" },
    ]);
  });

  it("waits for a review on the new head, and on changes the review asked for with no open thread", () => {
    expect([
      verdict({ review: "none" }),
      verdict({ review: "changes_requested", openReviewRuns: 1 }),
      verdict({ review: "changes_requested" }),
    ]).toEqual([
      { kind: "wait", reason: "review_pending" },
      { kind: "wait", reason: "review_pending" },
      { kind: "wait", reason: "review_changes_requested" },
    ]);
  });
});
