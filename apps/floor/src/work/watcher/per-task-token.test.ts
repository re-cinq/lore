import { describe, it, expect } from "vitest";
import { decideTokenCleanup } from "./per-task-token.js";

describe("decideTokenCleanup", () => {
  it("routes to central when the task has no station run at all (a legacy single-CR task)", () => {
    expect(decideTokenCleanup([], "central-1")).toBe("central");
  });

  it("routes to central when one of the task's runs was claimed by the central cluster-agent", () => {
    expect(
      decideTokenCleanup(
        [
          { status: "claimed", clusterAgentId: "sat-1" },
          { status: "claimed", clusterAgentId: "central-1" },
        ],
        "central-1",
      ),
    ).toBe("central");
  });

  it("routes to central for a legacy running row, which the push path launched centrally", () => {
    expect(
      decideTokenCleanup([{ status: "running", clusterAgentId: null }], null),
    ).toBe("central");
  });

  it("skips when every run was claimed by a cluster this Floor cannot reach", () => {
    expect(
      decideTokenCleanup(
        [
          { status: "claimed", clusterAgentId: "sat-1" },
          { status: "claimed", clusterAgentId: "sat-2" },
        ],
        "central-1",
      ),
    ).toBe("skip");
  });
});
