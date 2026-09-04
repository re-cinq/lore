import { describe, it, expect } from "vitest";
import type { AssemblyLineNode } from "./loader.js";
import {
  malformedNodeResultLine,
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
      failureDetail: "validation failed: lint",
    });
  });

  it("leaves failureDetail unset on a failed outcome carrying no Lore-Validation-Failed extra (nothing to lift)", () => {
    const status: AgentNodeStatus = {
      phase: "Succeeded",
      output: resultLine({
        outcome: "failed",
        extras: { "Lore-Detect-Summary": "3 specs ok" },
      }),
    };

    expect(stationNodeOutcome(detectNode, status)).toEqual({
      outcome: "failed",
      extras: { "Lore-Detect-Summary": "3 specs ok" },
    });
  });

  it("carries the failing commands' output into the detail when the station sent it (the agent sent back to fix the code reads this: 'lint' says where, the compiler's words say what)", () => {
    const status: AgentNodeStatus = {
      phase: "Succeeded",
      output: resultLine({
        outcome: "failed",
        extras: {
          "Lore-Validation-Failed": "lint,build",
          "Lore-Validation-Output": "$ lint\nfoo.ts:1:1 error TS1005",
        },
      }),
    };

    expect(stationNodeOutcome(detectNode, status).failureDetail).toBe(
      "validation failed: lint,build\n\n$ lint\nfoo.ts:1:1 error TS1005",
    );
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

  it("falls back to the Job-level reason when the agent errored with an empty string (under `??` that empty string used to win precedence, discarding the only real information)", () => {
    expect(
      stationNodeOutcome(
        { type: "agent" },
        {
          phase: "Failed",
          errorText: "",
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

describe("an outcome line that was spoken is never silently a success", () => {
  const agentNode: AssemblyLineNode = {
    id: "analyse-specs",
    type: "agent",
    prompt_ref: "spec-analysis",
  };

  it("parses the legacy bare-word form the spec-analysis prompt taught (a deployed recipe instructs exactly this; rejecting it turned a station's objection into `success`, #1469)", () => {
    expect(
      parseNodeResult("JSON is valid.\nLORE_NODE_RESULT: changes_requested"),
    ).toEqual({ outcome: "changes_requested", extras: {} });
  });

  it("counts only line-start markers, and the last one when several appear (an agent quoting its own contract mid-sentence must not decide the node)", () => {
    expect(
      parseNodeResult("the contract says LORE_NODE_RESULT: failed somewhere"),
    ).toBeNull();
    expect(
      parseNodeResult(
        'LORE_NODE_RESULT: {"outcome": "failed"}\nLORE_NODE_RESULT: success',
      ),
    ).toEqual({ outcome: "success", extras: {} });
  });

  it("names the malformed line when a marker is present but unparseable", () => {
    expect(malformedNodeResultLine("LORE_NODE_RESULT: {not json}")).toBe(
      "LORE_NODE_RESULT: {not json}",
    );
    expect(malformedNodeResultLine("no marker at all")).toBeNull();
    expect(
      malformedNodeResultLine('LORE_NODE_RESULT: {"outcome": "success"}'),
    ).toBeNull();
  });

  it("treats a bare LORE_NODE_RESULT: with nothing after it as spoken but empty, a half-followed contract that must report rather than pass", () => {
    expect(malformedNodeResultLine("LORE_NODE_RESULT:")).not.toBeNull();
    expect(
      stationNodeOutcome(agentNode, {
        phase: "Succeeded",
        output: "LORE_NODE_RESULT:",
      }),
    ).toMatchObject({ outcome: "failed" });
  });

  it("fails a node whose LORE_NODE_RESULT is present but unparseable, instead of silently succeeding", () => {
    const result = stationNodeOutcome(agentNode, {
      phase: "Succeeded",
      output: 'LORE_NODE_RESULT: {"outcome": "exploded"}',
    });

    expect(result).toMatchObject({ outcome: "failed" });
    expect(result.failureDetail).toContain('{"outcome": "exploded"}');
  });

  it("routes a bare-word changes_requested as changes_requested", () => {
    expect(
      stationNodeOutcome(agentNode, {
        phase: "Succeeded",
        output: "spec-plan.json written\nLORE_NODE_RESULT: changes_requested",
      }),
    ).toMatchObject({ outcome: "changes_requested" });
  });
});

describe("stationNodeOutcome lifts validation extras into failureDetail", () => {
  it("derives the detail from Lore-Validation-Failed when the payload has none", () => {
    const result = stationNodeOutcome(
      { type: "validate" } as never,
      {
        phase: "Succeeded",
        output:
          'LORE_NODE_RESULT: {"outcome":"failed","extras":{"Lore-Validation":"failed","Lore-Validation-Lang":"node","Lore-Validation-Failed":"lint,build"}}',
      } as never,
    );

    expect(result).toMatchObject({
      outcome: "failed",
      failureDetail: "validation failed: lint,build",
    });
  });
});
