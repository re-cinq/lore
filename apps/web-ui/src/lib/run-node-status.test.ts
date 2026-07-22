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
