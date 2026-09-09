import { describe, it, expect } from "vitest";
import { lineOutcomeFromVisits } from "./line-outcome.js";

describe("lineOutcomeFromVisits", () => {
  it("blames the terminal fix-ci failure, not the recovered ready-for-review retry (regression seen in run 52c3fdd5)", () => {
    const outcome = lineOutcomeFromVisits([
      { nodeId: "tdd-round", iteration: 1, outcome: "success" },
      {
        nodeId: "ready-for-review",
        iteration: 1,
        outcome: "failed",
        failureDetail: "BackoffLimitExceeded",
      },
      { nodeId: "ready-for-review", iteration: 2, outcome: "success" },
      { nodeId: "await-pr", iteration: 2, outcome: "changes_requested" },
      {
        nodeId: "fix-ci",
        iteration: 1,
        outcome: "failed",
        failureDetail: "pod died",
      },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    expect(outcome).toEqual({
      outcome: "failed",
      reason: 'node "fix-ci" failed: pod died',
    });
  });

  it("closes completed when the only failure was recovered by the node's later success", () => {
    const outcome = lineOutcomeFromVisits([
      { nodeId: "review", iteration: 1, outcome: "failed" },
      { nodeId: "review", iteration: 2, outcome: "success" },
      { nodeId: "done", iteration: 1, outcome: "success" },
    ]);

    expect(outcome).toEqual({ outcome: "completed" });
  });

  it("still fails on an unrecovered failure that routed to the retrospective", () => {
    const outcome = lineOutcomeFromVisits([
      { nodeId: "review", iteration: 1, outcome: "failed" },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    expect(outcome).toEqual({
      outcome: "failed",
      reason: 'node "review" failed',
    });
  });
});
