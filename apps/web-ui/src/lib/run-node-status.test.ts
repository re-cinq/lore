import { describe, it, expect } from "vitest";
import {
  nodeStatusVisual,
  outcomeVisual,
  nodeRunVisual,
} from "./run-node-status";

describe("nodeStatusVisual", () => {
  it("returns tone idle and label Pending for idle", () => {
    expect(nodeStatusVisual("idle")).toEqual({
      tone: "idle",
      label: "Pending",
    });
  });

  it("returns tone running and label Running for running", () => {
    expect(nodeStatusVisual("running")).toEqual({
      tone: "running",
      label: "Running",
    });
  });

  it("returns tone ok and label Succeeded for succeeded", () => {
    expect(nodeStatusVisual("succeeded")).toEqual({
      tone: "ok",
      label: "Succeeded",
    });
  });

  it("returns tone err and label Failed for failed", () => {
    expect(nodeStatusVisual("failed")).toEqual({
      tone: "err",
      label: "Failed",
    });
  });
});

describe("outcomeVisual", () => {
  it("returns tone ok and label Succeeded for success", () => {
    expect(outcomeVisual("success")).toEqual({
      tone: "ok",
      label: "Succeeded",
    });
  });

  it("returns tone warn and label Changes requested for changes_requested", () => {
    expect(outcomeVisual("changes_requested")).toEqual({
      tone: "warn",
      label: "Changes requested",
    });
  });

  it("returns tone err and label Failed for a plain failed verdict", () => {
    expect(outcomeVisual("failed")).toEqual({ tone: "err", label: "Failed" });
  });

  it("returns tone err and label Failed for a kind-scoped failure", () => {
    expect(outcomeVisual("review-failed")).toEqual({
      tone: "err",
      label: "Failed",
    });
  });
});

describe("nodeRunVisual", () => {
  it("prefers the verdict over the execution status when an outcome is present", () => {
    expect(nodeRunVisual("failed", "succeeded")).toEqual({
      tone: "err",
      label: "Failed",
    });
  });

  it("falls back to the execution status when there is no recorded outcome", () => {
    expect(nodeRunVisual(null, "running")).toEqual({
      tone: "running",
      label: "Running",
    });
  });
});

describe("a parked human station", () => {
  it("reads as waiting for you, not Running, while the author holds the round", () => {
    // A wait node's row seeds `running` like any other open node, because nothing
    // distinguishes them at that layer. But a wait node never dispatches a pod, so
    // the spinner would be promising work that is not happening — and the person it
    // is waiting for is the one reading the screen.
    expect(nodeRunVisual(null, "running", "feature_review")).toEqual({
      tone: "waiting",
      label: "Waiting for you",
    });
  });

  it("names the other worker when the station is the PR view", () => {
    expect(nodeRunVisual(null, "running", "pr_review")).toEqual({
      tone: "waiting",
      label: "Waiting for the spec PR",
    });
  });

  it("stays Pending before the walk reaches it", () => {
    // Not yet parked — the round it belongs to has not happened. Announcing
    // "waiting for you" here would ask for input the line cannot accept.
    expect(nodeRunVisual(null, "idle", "feature_review")).toEqual({
      tone: "idle",
      label: "Pending",
    });
  });

  it("shows the recorded verdict once the author has answered", () => {
    expect(
      nodeRunVisual("changes_requested", "running", "feature_review"),
    ).toEqual({ tone: "warn", label: "Changes requested" });
  });
});
