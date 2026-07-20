import { describe, it, expect } from "vitest";
import { nodeStatusVisual } from "./run-node-status";

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
