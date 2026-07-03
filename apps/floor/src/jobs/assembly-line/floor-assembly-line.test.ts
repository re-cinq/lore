import { describe, it, expect } from "vitest";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { AssemblyLineNode, NodeContext, ProductionHandlersDeps } from "@re-cinq/lore-assembly-lines";
import {
  nodeAgentName,
  nodeAgentSpec,
  buildFloorAssemblyLineHandlers,
  type FloorAssemblyLineTask,
  type FloorAssemblyLinePorts,
} from "./floor-assembly-line.js";

const task: FloorAssemblyLineTask = {
  taskId: "abcdef1234567890",
  assemblyLineId: "a1b2c3d4e5f6a7b8",
  taskType: "implementation",
  description: "Implement the spec",
  targetRepo: "re-cinq/lore",
  branch: "lore/impl-abcdef12",
};

const ctx: NodeContext = {
  taskId: task.taskId,
  assemblyLineId: task.assemblyLineId,
  branchName: task.branch,
  gitDir: "/work",
  iteration: 0,
  assemblyLineName: "implementation",
};

const episodeDeps: ProductionHandlersDeps = {
  writeEpisode: async () => {},
  writeEpisodeWithCuration: async () => {},
};

describe("nodeAgentSpec", () => {
  it("builds a per-node spec: distinct name, node prompt + model, task repo/branch", () => {
    const node: AssemblyLineNode = { id: "implement", type: "agent", model: "claude-sonnet-4-6" };
    expect(nodeAgentSpec(node, task, "do it")).toEqual({
      taskId: "abcdef1234567890",
      taskType: "implementation",
      description: "Implement the spec",
      prompt: "do it",
      targetRepo: "re-cinq/lore",
      branch: "lore/impl-abcdef12",
      model: "claude-sonnet-4-6",
      name: "a1b2c3d4-implement",
    });
    expect(nodeAgentName(task.assemblyLineId, "review")).toBe("a1b2c3d4-review");
  });

  it("omits model when the node inherits it", () => {
    expect(nodeAgentSpec({ id: "push", type: "agent" }, task, "p")).not.toHaveProperty("model");
  });
});

describe("buildFloorAssemblyLineHandlers", () => {
  function ports(over: Partial<FloorAssemblyLinePorts> = {}) {
    const dispatched: LoreTaskSpec[] = [];
    const base: FloorAssemblyLinePorts = {
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
    const handlers = buildFloorAssemblyLineHandlers(task, p);
    const result = await handlers.agent({ id: "implement", type: "agent" }, ctx);
    expect(result.outcome).toBe("success");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ name: "a1b2c3d4-implement", prompt: "prompt:implement" });
    // The CR spec keeps the taskId — the watcher/reaper probe Agent CRs by task-id label.
    expect(dispatched[0]).toMatchObject({ taskId: "abcdef1234567890" });
  });

  it("github_action slot gates on the branch CI conclusion", async () => {
    const { ports: p } = ports({ ciConclusion: async () => "failure" });
    const handlers = buildFloorAssemblyLineHandlers(task, p);
    const result = await handlers.github_action!({ id: "ci", type: "github_action" }, ctx);
    expect(result.outcome).toBe("failed");
  });
});
