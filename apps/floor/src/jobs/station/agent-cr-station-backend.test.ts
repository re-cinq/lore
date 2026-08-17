import { describe, it, expect } from "vitest";
import type {
  LoreTaskSpec,
  StationBackend,
  StationLaunchResult,
} from "@re-cinq/lore-shared";
import type { AssemblyRunStartInput } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
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

const assemblyRuns = new Set(["implementation", "general", "gap-fill"]);

describe("shouldUseAssemblyLine", () => {
  it("is true only when an assembly line exists for the task type", () => {
    expect(shouldUseAssemblyLine("implementation", assemblyRuns)).toBe(true);
    expect(shouldUseAssemblyLine("onboard", assemblyRuns)).toBe(false);
  });

  it("routes gap-fill to the assembly line and runbook to single-Agent (no runbook.yaml)", () => {
    // Pins the post-migration split: gap-fill.yaml exists so gap-fill runs the
    // Floor-side line (per-node Agent CRs); runbook has no assembly line so it
    // stays a single Agent. A future stray runbook.yaml is then a conscious choice.
    expect(shouldUseAssemblyLine("gap-fill", assemblyRuns)).toBe(true);
    expect(shouldUseAssemblyLine("runbook", assemblyRuns)).toBe(false);
  });
});

function makeBackend(openTaskIds: string[] = []) {
  const assemblyLine = new FakeBackend("assembly-line");
  const single = new FakeBackend("single");
  const started: AssemblyRunStartInput[] = [];
  const backend = new AgentCrStationBackend(
    assemblyLine,
    single,
    assemblyRuns,
    {
      start: async (input) => {
        started.push(input);

        return "run-row-1";
      },
      listForTask: async (taskId) =>
        openTaskIds.includes(taskId)
          ? [{ id: "open-row", status: "running" } as never]
          : [],
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
        blueprintName: "runbook",
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

  it("skips the run row on a crash-recovery re-dispatch when one is already open", async () => {
    // findRecoverable re-claims a mid-dispatch single-CR task; the second launch
    // reuses the same CR, so it must not mint a phantom second row.
    const { backend, started, single } = makeBackend(["task-7"]);

    await backend.launch({ ...spec("runbook"), taskId: "task-7" });

    expect(started).toEqual([]);
    expect(single.launched).toEqual(["runbook"]); // the CR re-dispatch still happens
  });

  it("probes isActive on the single-Agent backend (finds both paths' Agents)", async () => {
    const { backend, assemblyLine, single } = makeBackend();

    expect(await backend.isActive("task-9")).toBe(true);
    expect(single.probed).toEqual(["task-9"]);
    expect(assemblyLine.probed).toEqual([]);
  });
});
