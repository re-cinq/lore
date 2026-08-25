import { describe, it, expect } from "vitest";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { statusFromAgentCr } from "./kube-agent-api.js";

describe("statusFromAgentCr", () => {
  it("a CR the controller has not stamped yet maps to Pending, not absence", () => {
    // Absence means "crashed between the row insert and the launch — relaunch me".
    // A born-but-unstamped CR read as absence made the reaper relaunch over a LIVE
    // pod every 60s, re-provisioning its recipe clone without the conversation
    // (#1466). The two must not share an answer.
    expect(
      statusFromAgentCr({ metadata: { name: "a1-review" } } as AgentCr),
    ).toEqual({ phase: "Pending" });
  });

  it("a stamped CR passes phase, output and failureReason through", () => {
    expect(
      statusFromAgentCr({
        metadata: { name: "a1-review" },
        status: {
          phase: "Failed",
          output: "LORE_NODE_RESULT: {}",
          failureReason: "BackoffLimitExceeded",
        },
      } as AgentCr),
    ).toEqual({
      phase: "Failed",
      output: "LORE_NODE_RESULT: {}",
      failureReason: "BackoffLimitExceeded",
    });
  });
});
