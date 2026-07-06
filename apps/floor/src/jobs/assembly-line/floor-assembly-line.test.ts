import { describe, it, expect } from "vitest";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { AssemblyLineNode, NodeContext, ProductionHandlersDeps } from "@re-cinq/lore-assembly-lines";
import {
  nodeAgentName,
  nodeAgentSpec,
  nodeStationSpec,
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

  it("every non-agent node dispatches a station CR and parses the LORE_NODE_RESULT line", async () => {
    const output = `logs\nLORE_NODE_RESULT: {"outcome":"failed","extras":{"Lore-Validation-Failed":"lint"}}`;
    const { ports: p, dispatched } = ports({ agentStatus: async () => ({ phase: "Succeeded", output }) });
    const handlers = buildFloorAssemblyLineHandlers(task, p);

    const result = await handlers.validate({ id: "validate", type: "validate", validator: "all" }, ctx);

    expect(result).toEqual({ outcome: "failed", extras: { "Lore-Validation-Failed": "lint" } });
    expect(dispatched).toEqual([
      expect.objectContaining({
        name: "a1b2c3d4-validate",
        stationRef: "def-validate",
        parameters: {
          station_input: JSON.stringify({
            assembly_line_id: task.assemblyLineId,
            node_id: "validate",
            node_type: "validate",
            repo: "re-cinq/lore",
            branch: "lore/impl-abcdef12",
            task_id: task.taskId,
            params: { validator: "all" },
          }),
        },
      }),
    ]);
  });

  it("gate, retrospective, github_action, and detect all resolve to station handlers", async () => {
    const output = `LORE_NODE_RESULT: {"outcome":"success","extras":{}}`;
    const { ports: p, dispatched } = ports({ agentStatus: async () => ({ phase: "Succeeded", output }) });
    const handlers = buildFloorAssemblyLineHandlers(task, p);

    for (const type of ["gate", "retrospective", "github_action", "detect"] as const) {
      expect(handlers[type]).toBeTypeOf("function");
    }
    const result = await handlers.gate!({ id: "merge-gate", type: "gate" }, ctx);
    expect(result.outcome).toBe("success");
    expect(dispatched[0]).toMatchObject({ stationRef: "def-gate" });
  });
});

describe("nodeStationSpec", () => {
  it("station_ref overrides the def-<type> default and job_ref rides in params", () => {
    const node: AssemblyLineNode = {
      id: "detect",
      type: "detect",
      job_ref: "spec_drift",
      station_ref: "acme-scanner",
    };
    const spec = nodeStationSpec(node, task);
    expect(spec).toMatchObject({ stationRef: "acme-scanner", name: "a1b2c3d4-detect" });
    expect(JSON.parse(spec.parameters!.station_input)).toMatchObject({
      node_type: "detect",
      params: { job_ref: "spec_drift" },
    });
  });
});

