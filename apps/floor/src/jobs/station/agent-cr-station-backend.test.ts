import { describe, it, expect } from "vitest";
import type {
  LoreTaskSpec,
  StationBackend,
  StationLaunchResult,
} from "@re-cinq/lore-shared";
import type { AssemblyLineStartInput } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
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

  it("routes gap-fill to the assembly line and runbook to single-Agent (no runbook.yaml)", () => {
    // Pins the post-migration split: gap-fill.yaml exists so gap-fill runs the
    // Floor-side line (per-node Agent CRs); runbook has no assembly line so it
    // stays a single Agent. A future stray runbook.yaml is then a conscious choice.
    expect(shouldUseAssemblyLine("gap-fill", assemblyLines)).toBe(true);
    expect(shouldUseAssemblyLine("runbook", assemblyLines)).toBe(false);
  });
});

function makeBackend() {
  const assemblyLine = new FakeBackend("assembly-line");
  const single = new FakeBackend("single");
  const started: AssemblyLineStartInput[] = [];
  const backend = new AgentCrStationBackend(
    assemblyLine,
    single,
    assemblyLines,
    {
      start: async (input) => {
        started.push(input);

        return "run-row-1";
      },
    },
  );

  return { backend, assemblyLine, single, started };
}

describe("AgentCrStationBackend", () => {
  it("routes assemblyLine-having task types to the assembly line, others to single-Agent", async () => {
    const { backend, assemblyLine, single } = makeBackend();

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

  it("records an assembly_lines run row for a single-Agent launch (total coverage)", async () => {
    const { backend, started } = makeBackend();

    await backend.launch({ ...spec("runbook"), taskId: "task-7" });

    expect(started).toEqual([
      {
        definitionName: "runbook",
        repo: "o/r",
        branch: "b",
        taskId: "task-7",
        args: { description: "" },
      },
    ]);
  });

  it("does not double-create a row for the assembly-line branch (start() lives in its backend)", async () => {
    const { backend, started } = makeBackend();

    await backend.launch(spec("implementation"));

    expect(started).toEqual([]);
  });

  it("probes isActive on the single-Agent backend (finds both paths' Agents)", async () => {
    const { backend, assemblyLine, single } = makeBackend();

    expect(await backend.isActive("task-9")).toBe(true);
    expect(single.probed).toEqual(["task-9"]);
    expect(assemblyLine.probed).toEqual([]);
  });
});
