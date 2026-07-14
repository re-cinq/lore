import { describe, it, expect } from "vitest";
import type { AssemblyLineNode } from "@re-cinq/lore-assembly-lines";
import {
  nodeAgentName,
  nodeAgentSpec,
  nodeStationSpec,
  type FloorAssemblyLineTask,
} from "./floor-assembly-line.js";

const task: FloorAssemblyLineTask = {
  taskId: "abcdef1234567890",
  pipelineTaskId: "abcdef1234567890",
  assemblyLineId: "a1b2c3d4e5f6a7b8",
  taskType: "implementation",
  description: "Implement the spec",
  targetRepo: "re-cinq/lore",
  branch: "lore/impl-abcdef12",
};

describe("nodeAgentSpec", () => {
  it("builds a per-node spec: distinct name, node prompt + model, task repo/branch", () => {
    const node: AssemblyLineNode = {
      id: "implement",
      type: "agent",
      model: "claude-sonnet-4-6",
    };

    expect(nodeAgentSpec(node, task, "do it")).toEqual({
      taskId: "abcdef1234567890",
      taskType: "implementation",
      description: "Implement the spec",
      prompt: "do it",
      targetRepo: "re-cinq/lore",
      branch: "lore/impl-abcdef12",
      model: "claude-sonnet-4-6",
      name: "a1b2c3d4-implement",
      extraLabels: {
        "lore.re-cinq.com/assembly-line-id": "a1b2c3d4e5f6a7b8",
        "lore.re-cinq.com/node-id": "implement",
        "lore.re-cinq.com/node-iteration": "1",
      },
    });
    expect(nodeAgentName(task.assemblyLineId, "review")).toBe(
      "a1b2c3d4-review",
    );
  });

  it("omits model when the node inherits it", () => {
    expect(
      nodeAgentSpec({ id: "push", type: "agent" }, task, "p"),
    ).not.toHaveProperty("model");
  });

  it("suffixes the CR name + labels with the iteration for a revisited node", () => {
    // Iteration 1 keeps the bare name (back-compat); a revisit (iteration>1) gets a
    // distinct name + label so it runs a fresh pod, not a 409-reuse of the prior CR.
    expect(nodeAgentName(task.assemblyLineId, "review", 2)).toBe(
      "a1b2c3d4-review-2",
    );
    const spec = nodeAgentSpec({ id: "review", type: "agent" }, task, "p", 2);

    expect(spec.name).toBe("a1b2c3d4-review-2");
    expect(spec.extraLabels?.["lore.re-cinq.com/node-iteration"]).toBe("2");
  });

  it("labels the CR with the full assembly-line id, node id and iteration (event-driven transitions)", () => {
    // The CR name only carries an 8-char prefix; the labels carry the full uuid so
    // the k8s watch can map a terminal node CR back to its (line, node, iteration).
    expect(
      nodeAgentSpec({ id: "implement", type: "agent" }, task, "p").extraLabels,
    ).toEqual({
      "lore.re-cinq.com/assembly-line-id": "a1b2c3d4e5f6a7b8",
      "lore.re-cinq.com/node-id": "implement",
      "lore.re-cinq.com/node-iteration": "1",
    });
    expect(
      nodeStationSpec({ id: "wrap", type: "retrospective" }, task).extraLabels,
    ).toEqual({
      "lore.re-cinq.com/assembly-line-id": "a1b2c3d4e5f6a7b8",
      "lore.re-cinq.com/node-id": "wrap",
      "lore.re-cinq.com/node-iteration": "1",
    });
  });
});
