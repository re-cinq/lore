import { describe, it, expect } from "vitest";
import { mapAgentToEvent } from "./k8s-map.js";

const LABEL = "lore.re-cinq.com/task-id";

describe("mapAgentToEvent", () => {
  it("maps a Succeeded CR to kubernetes.agent.succeeded keyed on task-id+phase", () => {
    const agent = {
      metadata: { name: "agent-t1", labels: { [LABEL]: "t1" } },
      status: { phase: "Succeeded" },
    };
    expect(mapAgentToEvent(agent)).toEqual({
      eventName: "kubernetes.agent.succeeded",
      source: "kubernetes",
      params: { taskId: "t1", agentName: "agent-t1", phase: "Succeeded" },
      dedupeKey: "k8s:t1:Succeeded",
    });
  });

  it("maps a Failed CR to kubernetes.agent.failed", () => {
    const agent = {
      metadata: { name: "agent-t2", labels: { [LABEL]: "t2" } },
      status: { phase: "Failed" },
    };
    expect(mapAgentToEvent(agent)).toMatchObject({
      eventName: "kubernetes.agent.failed",
      dedupeKey: "k8s:t2:Failed",
    });
  });

  it("returns null for a non-terminal phase (Running)", () => {
    expect(
      mapAgentToEvent({
        metadata: { labels: { [LABEL]: "t3" } },
        status: { phase: "Running" },
      }),
    ).toBeNull();
  });

  it("returns null when the task-id label is absent", () => {
    expect(
      mapAgentToEvent({
        metadata: { name: "x" },
        status: { phase: "Succeeded" },
      }),
    ).toBeNull();
  });
});
