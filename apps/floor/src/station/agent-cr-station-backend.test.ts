import { describe, it, expect } from "vitest";
import type { LoreTaskSpec, StationBackend, StationLaunchResult } from "@re-cinq/lore-shared";
import { shouldUseGraph, AgentCrStationBackend } from "./agent-cr-station-backend.js";

class FakeBackend implements StationBackend {
  readonly launched: string[] = [];
  readonly probed: string[] = [];
  constructor(private readonly ref: string) {}
  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    this.launched.push(spec.taskType);
    return { ref: this.ref, launched: true };
  }
  async isActive(taskId: string): Promise<boolean> {
    this.probed.push(taskId);
    return true;
  }
}

const spec = (taskType: string): LoreTaskSpec => ({
  taskId: "t",
  taskType,
  description: "",
  prompt: "",
  targetRepo: "o/r",
  branch: "b",
});

const workflows = new Set(["implementation", "general", "gap-fill"]);

describe("shouldUseGraph", () => {
  it("is true only when a workflow exists for the task type", () => {
    expect(shouldUseGraph("implementation", workflows)).toBe(true);
    expect(shouldUseGraph("onboard", workflows)).toBe(false);
  });
});

describe("AgentCrStationBackend", () => {
  it("routes workflow-having task types to the graph, others to single-Agent", async () => {
    const graph = new FakeBackend("graph");
    const single = new FakeBackend("single");
    const backend = new AgentCrStationBackend(graph, single, workflows);

    expect(await backend.launch(spec("implementation"))).toEqual({ ref: "graph", launched: true });
    expect(await backend.launch(spec("onboard"))).toEqual({ ref: "single", launched: true });
    expect(graph.launched).toEqual(["implementation"]);
    expect(single.launched).toEqual(["onboard"]);
  });

  it("probes isActive on the single-Agent backend (finds both paths' Agents)", async () => {
    const graph = new FakeBackend("graph");
    const single = new FakeBackend("single");
    expect(await new AgentCrStationBackend(graph, single, workflows).isActive("task-9")).toBe(true);
    expect(single.probed).toEqual(["task-9"]);
    expect(graph.probed).toEqual([]);
  });
});
