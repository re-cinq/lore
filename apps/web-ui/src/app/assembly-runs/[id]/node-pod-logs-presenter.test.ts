import { describe, it, expect } from "vitest";
import {
  nodeLogsUrl,
  shouldPollNode,
  unavailableMessage,
  type NodeLogsResponse,
} from "./node-pod-logs-presenter";

function resp(over: Partial<NodeLogsResponse>): NodeLogsResponse {
  return {
    available: true,
    logs: "x",
    phase: "Running",
    podName: "p",
    ...over,
  };
}

describe("nodeLogsUrl", () => {
  it("builds the proxy path and encodes the agent CR name", () => {
    expect(nodeLogsUrl("run-1", "05fc5491-review")).toBe(
      "/api/assembly-runs/run-1/nodes/05fc5491-review/logs",
    );
  });
});

describe("shouldPollNode", () => {
  it("returns false before any response", () => {
    expect(shouldPollNode(null)).toBe(false);
  });

  it("returns true while a live pod is running", () => {
    expect(shouldPollNode(resp({ phase: "Running" }))).toBe(true);
  });

  it("returns false once the pod reaches a terminal phase", () => {
    expect(shouldPollNode(resp({ phase: "Succeeded" }))).toBe(false);
  });

  it("returns false when logs are unavailable", () => {
    expect(shouldPollNode(resp({ available: false, phase: "Running" }))).toBe(
      false,
    );
  });
});

describe("unavailableMessage", () => {
  it("explains a garbage-collected pod", () => {
    expect(unavailableMessage("no-pod")).toMatch(/cleaned up/);
  });

  it("explains a not-yet-started pod", () => {
    expect(unavailableMessage("no-job")).toMatch(/hasn't started/);
  });

  it("explains a missing agent", () => {
    expect(unavailableMessage("no-agent")).toMatch(/No agent/);
  });

  it("falls back for an unknown reason", () => {
    expect(unavailableMessage()).toMatch(/not available/);
  });
});
