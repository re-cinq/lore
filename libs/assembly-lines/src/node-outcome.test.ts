import { describe, it, expect } from "vitest";
import type { AssemblyLineNode } from "./loader.js";
import {
  parseNodeResult,
  parseReviewVerdict,
  stationNodeOutcome,
  type AgentNodeStatus,
} from "./node-outcome.js";

const detectNode: AssemblyLineNode = {
  id: "detect",
  type: "detect",
  job_ref: "spec_drift",
};
const resultLine = (payload: unknown) =>
  `some log\nLORE_NODE_RESULT: ${JSON.stringify(payload)}`;

describe("parseNodeResult", () => {
  it("reads outcome and extras from the LORE_NODE_RESULT line", () => {
    expect(
      parseNodeResult(
        resultLine({
          outcome: "success",
          extras: { "Lore-Detect-Summary": "3 specs ok" },
        }),
      ),
    ).toEqual({
      outcome: "success",
      extras: { "Lore-Detect-Summary": "3 specs ok" },
    });
  });

  it("accepts a failed outcome as a normal result", () => {
    expect(parseNodeResult(resultLine({ outcome: "failed" }))).toEqual({
      outcome: "failed",
      extras: {},
    });
  });

  it("is null on absent, malformed, or unknown-outcome payloads", () => {
    expect(parseNodeResult(undefined)).toBeNull();
    expect(parseNodeResult("just logs, no result line")).toBeNull();
    expect(parseNodeResult("LORE_NODE_RESULT: {not json}")).toBeNull();
    expect(parseNodeResult(resultLine({ outcome: "exploded" }))).toBeNull();
  });

  it("drops non-string extras values", () => {
    expect(
      parseNodeResult(
        resultLine({ outcome: "success", extras: { ok: "yes", n: 7 } }),
      ),
    ).toEqual({
      outcome: "success",
      extras: { ok: "yes" },
    });
  });
});

describe("stationNodeOutcome", () => {
  it("uses the LORE_NODE_RESULT line on Succeeded", () => {
    const status: AgentNodeStatus = {
      phase: "Succeeded",
      output: resultLine({
        outcome: "failed",
        extras: { "Lore-Validation-Failed": "lint" },
      }),
    };

    expect(stationNodeOutcome(detectNode, status)).toEqual({
      outcome: "failed",
      extras: { "Lore-Validation-Failed": "lint" },
    });
  });

  it("falls back to the review verdict, then success", () => {
    const agentNode: AssemblyLineNode = { id: "review", type: "agent" };

    expect(
      stationNodeOutcome(agentNode, {
        phase: "Succeeded",
        output: "REVIEW_RESULT:CHANGES_REQUESTED",
      }).outcome,
    ).toBe("changes_requested");
    expect(
      stationNodeOutcome(detectNode, {
        phase: "Succeeded",
        output: "no result line",
      }).outcome,
    ).toBe("success");
  });

  it("maps Failed to station-failed for non-agent nodes and agent-failed for agent nodes", () => {
    expect(
      stationNodeOutcome(detectNode, {
        phase: "Failed",
        failureReason: "deadline",
      }),
    ).toEqual({
      outcome: "failed",
      failureClass: "unknown",
      failureDetail: "deadline",
      extras: {
        "Lore-Validation-Status": "station-failed",
        "Lore-Validation-Summary": "deadline",
      },
    });
    expect(
      stationNodeOutcome({ type: "agent" }, { phase: "Failed" }).extras?.[
        "Lore-Validation-Status"
      ],
    ).toBe("agent-failed");
  });
});

describe("stationNodeOutcome failure classification", () => {
  it("classifies the agent's own terminal text, not the Job-level reason", () => {
    expect(
      stationNodeOutcome(
        { type: "agent" },
        {
          phase: "Failed",
          errorText: "Credit balance is too low",
          failureReason:
            "BackoffLimitExceeded: Job has reached the specified backoff limit",
        },
      ),
    ).toMatchObject({
      outcome: "failed",
      failureClass: "anthropic-credit",
      failureDetail: "Credit balance is too low",
    });
  });

  it("falls back to the Job-level reason when the agent printed nothing", () => {
    expect(
      stationNodeOutcome(
        { type: "agent" },
        {
          phase: "Failed",
          failureReason:
            "BackoffLimitExceeded: Job has reached the specified backoff limit",
        },
      ),
    ).toMatchObject({
      failureClass: "infra",
      failureDetail:
        "BackoffLimitExceeded: Job has reached the specified backoff limit",
    });
  });

  it("classifies unknown for a failure with neither text", () => {
    expect(
      stationNodeOutcome({ type: "agent" }, { phase: "Failed" }),
    ).toMatchObject({
      failureClass: "unknown",
      failureDetail: "agent run failed",
    });
  });

  it("carries no failure class on a successful node", () => {
    expect(
      stationNodeOutcome({ type: "agent" }, { phase: "Succeeded" }),
    ).toEqual({ outcome: "success" });
  });
});

describe("parseReviewVerdict", () => {
  it("maps APPROVED to success and CHANGES_REQUESTED to changes_requested", () => {
    expect(parseReviewVerdict("notes\nREVIEW_RESULT:APPROVED")).toBe("success");
    expect(parseReviewVerdict("REVIEW_RESULT:CHANGES_REQUESTED: fix it")).toBe(
      "changes_requested",
    );
  });

  it("returns null for empty output or no marker", () => {
    expect(parseReviewVerdict(undefined)).toBeNull();
    expect(parseReviewVerdict("just logs, no verdict")).toBeNull();
  });
});
