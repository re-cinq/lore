import { describe, it, expect } from "vitest";
import type {
  LoreTaskSpec,
  StationBackend,
  StationLaunchResult,
} from "@re-cinq/lore-shared";
import {
  shouldUseAssemblyLine,
  AgentCrStationBackend,
} from "./agent-cr-station-backend.js";

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

const assemblyLines = new Set(["implementation", "general", "gap-fill"]);

describe("shouldUseAssemblyLine", () => {
  it("is true only when an assembly line exists for the task type", () => {
    expect(shouldUseAssemblyLine("implementation", assemblyLines)).toBe(true);
    expect(shouldUseAssemblyLine("onboard", assemblyLines)).toBe(false);
  });
});

describe("AgentCrStationBackend", () => {
  it("routes assemblyLine-having task types to the assembly line, others to single-Agent", async () => {
    const assemblyLine = new FakeBackend("assembly-line");
    const single = new FakeBackend("single");
    const backend = new AgentCrStationBackend(
      assemblyLine,
      single,
      assemblyLines,
    );

    expect(await backend.launch(spec("implementation"))).toEqual({
      ref: "assembly-line",
      launched: true,
    });
    expect(await backend.launch(spec("onboard"))).toEqual({
      ref: "single",
      launched: true,
    });
    expect(assemblyLine.launched).toEqual(["implementation"]);
    expect(single.launched).toEqual(["onboard"]);
  });

  it("probes isActive on the single-Agent backend (finds both paths' Agents)", async () => {
    const assemblyLine = new FakeBackend("assembly-line");
    const single = new FakeBackend("single");
    expect(
      await new AgentCrStationBackend(
        assemblyLine,
        single,
        assemblyLines,
      ).isActive("task-9"),
    ).toBe(true);
    expect(single.probed).toEqual(["task-9"]);
    expect(assemblyLine.probed).toEqual([]);
  });
});
