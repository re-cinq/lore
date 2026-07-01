import { describe, it, expect } from "vitest";
import type { Agent } from "@re-cinq/agent-contracts";
import {
  taskIdOf,
  taskTypeOf,
  parseReviewResult,
  decideCiGate,
  decideAgentOutcome,
  agentIsTerminal,
} from "./agent-watcher-logic.js";

describe("taskIdOf / taskTypeOf", () => {
  it("reads the labels AgentCrBackend sets", () => {
    const agent: Agent = {
      metadata: {
        labels: {
          "lore.re-cinq.com/task-id": "t1",
          "lore.re-cinq.com/task-type": "implementation",
        },
      },
    };
    expect(taskIdOf(agent)).toBe("t1");
    expect(taskTypeOf(agent)).toBe("implementation");
  });
  it("returns undefined when the labels are absent", () => {
    expect(taskIdOf({})).toBeUndefined();
    expect(taskTypeOf({})).toBeUndefined();
  });
});

describe("parseReviewResult", () => {
  it("parses APPROVED", () => {
    expect(parseReviewResult("notes\nREVIEW_RESULT:APPROVED\n")).toBe("approved");
  });
  it("parses CHANGES_REQUESTED with trailing feedback", () => {
    expect(parseReviewResult("REVIEW_RESULT: CHANGES_REQUESTED: fix the thing")).toBe(
      "changes_requested",
    );
  });
  it("returns undefined when there is no marker or no output", () => {
    expect(parseReviewResult("looks fine")).toBeUndefined();
    expect(parseReviewResult(undefined)).toBeUndefined();
  });
});

describe("decideCiGate", () => {
  it("defers on a red or still-running CI", () => {
    expect(decideCiGate("failure")).toBe("defer");
    expect(decideCiGate("pending")).toBe("defer");
  });
  it("proceeds on green, or when no CI is configured", () => {
    expect(decideCiGate("success")).toBe("proceed");
    expect(decideCiGate("none")).toBe("proceed");
  });
});

describe("decideAgentOutcome", () => {
  const base = {
    phase: "Succeeded" as string | undefined,
    taskType: "implementation" as string | undefined,
    reviewResult: undefined,
    changedFiles: 3,
    failureReason: undefined as string | undefined,
    alreadyHandled: false,
  };

  it("ignores an already-handled task", () => {
    expect(decideAgentOutcome({ ...base, alreadyHandled: true })).toEqual({ kind: "ignore" });
  });
  it("maps Failed to failed with the reason (or unknown)", () => {
    expect(decideAgentOutcome({ ...base, phase: "Failed", failureReason: "boom" })).toEqual({
      kind: "failed",
      reason: "boom",
    });
    expect(decideAgentOutcome({ ...base, phase: "Failed" })).toEqual({
      kind: "failed",
      reason: "unknown",
    });
  });
  it("ignores a non-terminal phase", () => {
    expect(decideAgentOutcome({ ...base, phase: "Running" })).toEqual({ kind: "ignore" });
  });
  it("maps a review task with a verdict to review-verdict, else ignore", () => {
    expect(
      decideAgentOutcome({ ...base, taskType: "review", reviewResult: "approved" }),
    ).toEqual({ kind: "review-verdict", result: "approved" });
    expect(decideAgentOutcome({ ...base, taskType: "review" })).toEqual({ kind: "ignore" });
  });
  it("maps Succeeded to no-changes / pr by the changed-file count", () => {
    expect(decideAgentOutcome({ ...base, changedFiles: 0 })).toEqual({ kind: "no-changes" });
    expect(decideAgentOutcome({ ...base, changedFiles: 2 })).toEqual({ kind: "pr" });
  });
});

describe("agentIsTerminal", () => {
  it("reflects the contract's terminal phases", () => {
    expect(agentIsTerminal({ status: { phase: "Succeeded" } })).toBe(true);
    expect(agentIsTerminal({ status: { phase: "Running" } })).toBe(false);
  });
});
