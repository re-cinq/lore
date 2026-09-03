import { describe, it, expect } from "vitest";
import { mapAgentToEvent, type AgentLike } from "./k8s-map.js";
import { ASSEMBLY_RUN_ID_LABEL } from "./agent-cr-labels.js";

const LABEL = "lore.re-cinq.com/task-id";
const AL_LABEL = "lore.re-cinq.com/assembly-line-id";
const NODE_LABEL = "lore.re-cinq.com/node-id";
const ITER_LABEL = "lore.re-cinq.com/node-iteration";

describe("mapAgentToEvent reads both CR-label spellings", () => {
  const labelled = (runLabel: string) => ({
    metadata: {
      name: "a1b2c3d4-review",
      labels: {
        [LABEL]: "a1b2c3d4-e5f6-4711-8000-000000000000",
        [runLabel]: "a1b2c3d4-e5f6-4711-8000-000000000000",
        [NODE_LABEL]: "review",
        [ITER_LABEL]: "1",
      },
    },
    status: { phase: "Succeeded" },
  });

  it("maps a CR carrying the pre-rename assembly-line-id label", () => {
    expect(mapAgentToEvent(labelled(AL_LABEL))?.eventName).toBe(
      "kubernetes.agent_node.succeeded",
    );
  });

  it("maps a CR carrying the assembly-run-id label the writer flip will stamp", () => {
    expect(mapAgentToEvent(labelled(ASSEMBLY_RUN_ID_LABEL))?.eventName).toBe(
      "kubernetes.agent_node.succeeded",
    );
  });
});

describe("mapAgentToEvent for assembly-line node CRs", () => {
  const nodeCr = (phase: string): AgentLike => ({
    metadata: {
      name: "a1b2c3d4-review",
      labels: {
        [LABEL]: "a1b2c3d4-e5f6-4711-8000-000000000000",
        [AL_LABEL]: "a1b2c3d4-e5f6-4711-8000-000000000000",
        [NODE_LABEL]: "review",
        [ITER_LABEL]: "1",
      },
    },
    status: { phase },
  });

  it("maps a labeled node CR to kubernetes.agent_node.succeeded deduped per CR name", () => {
    expect(mapAgentToEvent(nodeCr("Succeeded"))).toEqual({
      eventName: "kubernetes.agent_node.succeeded",
      source: "kubernetes",
      params: {
        assemblyLineId: "a1b2c3d4-e5f6-4711-8000-000000000000",
        nodeId: "review",
        iteration: 1,
        agentName: "a1b2c3d4-review",
        taskId: "a1b2c3d4-e5f6-4711-8000-000000000000",
        phase: "Succeeded",
        status: { phase: "Succeeded" },
      },
      dedupeKey: "k8s:a1b2c3d4-review:Succeeded",
    });
  });

  it("carries the CR's output on the reported status", () => {
    const cr = nodeCr("Succeeded");

    cr.status = {
      phase: "Succeeded",
      output: 'LORE_NODE_RESULT: {"outcome":"success"}',
    };

    expect(mapAgentToEvent(cr)?.params?.status).toEqual({
      phase: "Succeeded",
      output: 'LORE_NODE_RESULT: {"outcome":"success"}',
    });
  });

  it("carries the CR's failureReason on a Failed CR's reported status", () => {
    const cr = nodeCr("Failed");

    cr.status = { phase: "Failed", failureReason: "BackoffLimitExceeded" };

    expect(mapAgentToEvent(cr)?.params?.status).toEqual({
      phase: "Failed",
      failureReason: "BackoffLimitExceeded",
    });
  });

  it("carries the iteration from the label and dedupes a revisit's CR separately", () => {
    const iter2 = mapAgentToEvent({
      metadata: {
        name: "a1b2c3d4-review-2",
        labels: {
          [LABEL]: "al-1",
          [AL_LABEL]: "al-1",
          [NODE_LABEL]: "review",
          [ITER_LABEL]: "2",
        },
      },
      status: { phase: "Succeeded" },
    });

    expect(iter2?.params).toMatchObject({ iteration: 2 });
    expect(iter2?.dedupeKey).toBe("k8s:a1b2c3d4-review-2:Succeeded");
  });

  it("maps a Failed node CR to kubernetes.agent_node.failed", () => {
    expect(mapAgentToEvent(nodeCr("Failed"))).toMatchObject({
      eventName: "kubernetes.agent_node.failed",
      dedupeKey: "k8s:a1b2c3d4-review:Failed",
    });
  });

  it("dedupes two node CRs of one line separately (the swallowed-second-node regression)", () => {
    const first = mapAgentToEvent({
      metadata: {
        name: "a1b2c3d4-review",
        labels: { [LABEL]: "al-1", [AL_LABEL]: "al-1", [NODE_LABEL]: "review" },
      },
      status: { phase: "Succeeded" },
    });
    const second = mapAgentToEvent({
      metadata: {
        name: "a1b2c3d4-refine",
        labels: { [LABEL]: "al-1", [AL_LABEL]: "al-1", [NODE_LABEL]: "refine" },
      },
      status: { phase: "Succeeded" },
    });

    expect(first?.dedupeKey).not.toBe(second?.dedupeKey);
  });
});

describe("mapAgentToEvent", () => {
  it("maps a Succeeded CR to kubernetes.agent.succeeded keyed on task-id+phase", () => {
    const agent = {
      metadata: { name: "agent-t1", labels: { [LABEL]: "t1" } },
      status: { phase: "Succeeded" },
    };

    expect(mapAgentToEvent(agent)).toEqual({
      eventName: "kubernetes.agent.succeeded",
      source: "kubernetes",
      params: {
        taskId: "t1",
        agentName: "agent-t1",
        phase: "Succeeded",
        status: { phase: "Succeeded" },
      },
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
