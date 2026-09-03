import { describe, it, expect } from "vitest";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { statusFromAgentCr } from "./agent-node-status.js";

describe("statusFromAgentCr", () => {
  it("a CR the controller has not stamped yet maps to Pending, not absence (#1466)", () => {
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
