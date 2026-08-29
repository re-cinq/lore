// The kubernetes.agent.* handler settles a run from what the event REPORTED,
// never by reading the cluster back.
//
// It used to re-GET the CR through the central cluster-agent, which made the
// handler silently cluster-bound: a run executed anywhere else answered
// `found:false` and its task sat `running` until a sweep took it. The event
// already carries the full status (mapAgentToEvent puts it there for this
// reason), so there is nothing left to fetch.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentFailed, agentSucceeded } from "./kubernetes.js";
import { processAgentTerminal } from "./watcher/agent-watcher.js";

vi.mock("./watcher/agent-watcher.js", () => ({
  processAgentTerminal: vi.fn(),
}));

const succeeded = {
  taskId: "t-1",
  agentName: "agent-11111111",
  phase: "Succeeded",
  status: { phase: "Succeeded", output: "done" },
};

beforeEach(() => {
  vi.mocked(processAgentTerminal).mockReset();
});

describe("kubernetes.agent handler", () => {
  it("settles the run from the event's own report, with no cluster read", async () => {
    await agentSucceeded(succeeded);

    expect(processAgentTerminal).toHaveBeenCalledWith({
      taskId: "t-1",
      agentName: "agent-11111111",
      phase: "Succeeded",
      output: "done",
      failureReason: undefined,
    });
  });

  it("passes a Failed report's reason through to the same processor", async () => {
    await agentFailed({
      taskId: "t-2",
      agentName: "a-2",
      phase: "Failed",
      status: { phase: "Failed", failureReason: "BackoffLimitExceeded" },
    });

    expect(processAgentTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "Failed",
        failureReason: "BackoffLimitExceeded",
      }),
    );
  });

  it("does nothing when the event carries no task id", async () => {
    await agentFailed({ agentName: "a-1", phase: "Failed" });

    expect(processAgentTerminal).not.toHaveBeenCalled();
  });

  it("does nothing for a non-terminal phase, which settles no run", async () => {
    await agentSucceeded({ taskId: "t-1", phase: "Running" });

    expect(processAgentTerminal).not.toHaveBeenCalled();
  });
});
