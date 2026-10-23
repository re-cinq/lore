import { describe, expect, it } from "vitest";
import {
  decideMergeReady,
  type MergeReadyInput,
} from "./decide-merge-ready.js";

const READY: MergeReadyInput = {
  mergeable: true,
  ci: "success",
  hasCiHistory: true,
  judgedSha: "abc",
  lastRedSha: null,
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

  it("sends a conflict and red CI to the fix, and fails red CI on the same sha the last fix left", () => {
    expect([
      verdict({ mergeable: false, ci: "failure" }),
      verdict({ ci: "failure" }),
      verdict({ ci: "failure", lastRedSha: "abc" }),
    ]).toEqual([
      {
        kind: "blocked",
        reason: "pr_conflicting",
        outcome: "changes_requested",
      },
      { kind: "blocked", reason: "ci_red", outcome: "changes_requested" },
      { kind: "blocked", reason: "ci_red_unchanged", outcome: "failed" },
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

  it("sends 2 open threads to the fix, but waits while a reply run is already answering them", () => {
    expect([
      verdict({ unresolvedThreads: 2 }),
      verdict({ unresolvedThreads: 2, openReviewRuns: 1 }),
    ]).toEqual([
      {
        kind: "blocked",
        reason: "unresolved_threads",
        outcome: "changes_requested",
      },
      { kind: "wait", reason: "address_in_flight" },
    ]);
  });

  it("waits for a review on the new head, and sends changes the review asked for with no open thread to the fix", () => {
    expect([
      verdict({ review: "none" }),
      verdict({ review: "changes_requested", openReviewRuns: 1 }),
      verdict({ review: "changes_requested" }),
    ]).toEqual([
      { kind: "wait", reason: "review_pending" },
      { kind: "wait", reason: "review_pending" },
      {
        kind: "blocked",
        reason: "review_changes_requested",
        outcome: "changes_requested",
      },
    ]);
  });
});
