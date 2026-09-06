import { describe, it, expect } from "vitest";
import { agentCrVisible } from "./cr-visibility.js";

describe("agentCrVisible", () => {
  it("a legacy running row's CR is visible — the push path launched it centrally", () => {
    expect(
      agentCrVisible({ status: "running", clusterAgentId: null }, null),
    ).toBe(true);
  });

  it("a row claimed by the central cluster-agent is visible", () => {
    expect(
      agentCrVisible(
        { status: "claimed", clusterAgentId: "central-1" },
        "central-1",
      ),
    ).toBe(true);
  });

  it("a row claimed by a satellite is not visible", () => {
    expect(
      agentCrVisible(
        { status: "claimed", clusterAgentId: "sat-1" },
        "central-1",
      ),
    ).toBe(false);
  });

  it("no claim is visible when no central cluster-agent is registered", () => {
    expect(
      agentCrVisible({ status: "claimed", clusterAgentId: "sat-1" }, null),
    ).toBe(false);
  });

  it("a queued row is not visible — it has no CR yet", () => {
    expect(
      agentCrVisible({ status: "queued", clusterAgentId: null }, "central-1"),
    ).toBe(false);
  });
});
