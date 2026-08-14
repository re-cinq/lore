import { describe, it, expect } from "vitest";
import type { AssemblyLineNode } from "./loader.js";
import {
  parseNodeResult,
  parseReviewVerdict,
  stationNodeOutcome,
  isBillingError,
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

describe("isBillingError", () => {
  it("matches the Anthropic credit-balance error case-insensitively", () => {
    expect(isBillingError("Credit balance is too low")).toBe(true);
    expect(isBillingError("credit balance too low to run")).toBe(true);
    expect(isBillingError("insufficient credits for this request")).toBe(true);
  });

  it("does not match unrelated errors or null", () => {
    expect(isBillingError("ENOENT: no such file")).toBe(false);
    expect(isBillingError("rate limit exceeded")).toBe(false);
    expect(isBillingError(null)).toBe(false);
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
