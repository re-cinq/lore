import { describe, it, expect } from "vitest";
import { isPermanentNodeFailure, nodeFailureReason } from "./failure-reason.js";

describe("nodeFailureReason", () => {
  it("names the node, the agent's own words, and what to do about them", () => {
    expect(
      nodeFailureReason({
        nodeId: "analyze",
        failureClass: "anthropic-credit",
        failureDetail: "Credit balance is too low",
      }),
    ).toEqual(
      'node "analyze" failed: Credit balance is too low — Top up the Anthropic ' +
        "account behind the agent's ANTHROPIC_API_KEY (Plans & Billing).",
    );
  });

  it("names the node alone when the failure was never classified", () => {
    expect(nodeFailureReason({ nodeId: "review" })).toEqual(
      'node "review" failed',
    );
  });

  it("reports the detail with no hint when the failure carries no class", () => {
    expect(
      nodeFailureReason({ nodeId: "push", failureDetail: "exit status 1" }),
    ).toEqual('node "push" failed: exit status 1');
  });

  it("reports the detail with no hint for a class it does not recognise", () => {
    expect(
      nodeFailureReason({
        nodeId: "push",
        failureClass: "moon-phase",
        failureDetail: "exit status 1",
      }),
    ).toEqual('node "push" failed: exit status 1');
  });

  it("keeps the detail when a class carries no useful hint", () => {
    expect(
      nodeFailureReason({
        nodeId: "write",
        failureClass: "unknown",
        failureDetail: "exit status 137",
      }),
    ).toContain("exit status 137");
  });
});

describe("isPermanentNodeFailure", () => {
  it("returns true for a dry account, which retrying cannot fix", () => {
    expect(
      isPermanentNodeFailure({
        nodeId: "analyze",
        failureClass: "anthropic-credit",
      }),
    ).toEqual(true);
  });

  it("returns false for a rate limit and for an unclassified failure", () => {
    expect(
      isPermanentNodeFailure({
        nodeId: "analyze",
        failureClass: "anthropic-rate-limit",
      }),
    ).toEqual(false);
    expect(isPermanentNodeFailure({ nodeId: "analyze" })).toEqual(false);
  });

  it("returns false for a class it does not recognise", () => {
    expect(
      isPermanentNodeFailure({ nodeId: "analyze", failureClass: "moon-phase" }),
    ).toEqual(false);
  });
});
