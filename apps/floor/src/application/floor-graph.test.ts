import { describe, it, expect } from "vitest";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { WorkflowNode, NodeContext, ProductionHandlersDeps } from "@re-cinq/lore-runner";
import {
  nodeAgentName,
  nodeAgentSpec,
  buildFloorGraphHandlers,
  type FloorGraphTask,
  type FloorGraphPorts,
} from "./floor-graph.js";

const task: FloorGraphTask = {
  taskId: "abcdef1234567890",
  taskType: "implementation",
  description: "Implement the spec",
  targetRepo: "re-cinq/lore",
  branch: "lore/impl-abcdef12",
};

const ctx: NodeContext = {
  taskId: task.taskId,
  branchName: task.branch,
  gitDir: "/work",
  iteration: 0,
  workflowName: "implementation",
};

const episodeDeps: ProductionHandlersDeps = {
  writeEpisode: async () => {},
  writeEpisodeWithCuration: async () => {},
};

describe("nodeAgentSpec", () => {
  it("builds a per-node spec: distinct name, node prompt + model, task repo/branch", () => {
    const node: WorkflowNode = { id: "implement", type: "agent", model: "claude-sonnet-4-6" };
    expect(nodeAgentSpec(node, task, "do it")).toEqual({
      taskId: "abcdef1234567890",
      taskType: "implementation",
      description: "Implement the spec",
      prompt: "do it",
      targetRepo: "re-cinq/lore",
      branch: "lore/impl-abcdef12",
      model: "claude-sonnet-4-6",
      name: "abcdef12-implement",
    });
    expect(nodeAgentName(task.taskId, "review")).toBe("abcdef12-review");
  });

  it("omits model when the node inherits it", () => {
    expect(nodeAgentSpec({ id: "push", type: "agent" }, task, "p")).not.toHaveProperty("model");
  });
});

describe("buildFloorGraphHandlers", () => {
  function ports(over: Partial<FloorGraphPorts> = {}) {
    const dispatched: LoreTaskSpec[] = [];
    const base: FloorGraphPorts = {
      dispatchAgent: async (spec) => { dispatched.push(spec); },
      resolvePrompt: (node) => `prompt:${node.id}`,
      agentStatus: async () => ({ phase: "Succeeded" }),
      ciConclusion: async () => "success",
      heartbeat: async () => {},
      sleep: async () => {},
      episodeDeps,
      ...over,
    };
    return { ports: base, dispatched };
  }

  it("agent slot dispatches one Agent CR per node from the node's prompt", async () => {
    const { ports: p, dispatched } = ports();
    const handlers = buildFloorGraphHandlers(task, p);
    const result = await handlers.agent({ id: "implement", type: "agent" }, ctx);
    expect(result.outcome).toBe("success");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ name: "abcdef12-implement", prompt: "prompt:implement" });
  });

  it("github_action slot gates on the branch CI conclusion", async () => {
    const { ports: p } = ports({ ciConclusion: async () => "failure" });
    const handlers = buildFloorGraphHandlers(task, p);
    const result = await handlers.github_action!({ id: "ci", type: "github_action" }, ctx);
    expect(result.outcome).toBe("failed");
  });
});
