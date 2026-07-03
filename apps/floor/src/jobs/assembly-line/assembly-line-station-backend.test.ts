import { describe, it, expect, vi } from "vitest";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { AssemblyLineStationBackend } from "./assembly-line-station-backend.js";
import type { runFloorAssemblyLineForTask, FloorAssemblyLineRuntime } from "./floor-assembly-line-run.js";
import type { FloorAssemblyLineTask } from "./floor-assembly-line.js";

const runtime = {} as FloorAssemblyLineRuntime;
const spec = (taskId: string): LoreTaskSpec => ({
  taskId,
  taskType: "implementation",
  description: "d",
  prompt: "p",
  targetRepo: "o/r",
  branch: "lore/b",
});

describe("AssemblyLineStationBackend", () => {
  it("fires the assembly line in the background and returns launched immediately", async () => {
    const seen: Array<Omit<FloorAssemblyLineTask, "assemblyLineId">> = [];
    const run = vi.fn<typeof runFloorAssemblyLineForTask>(async (task) => {
      seen.push(task);
      return { ranWork: true, reason: "completed" };
    });
    const backend = new AssemblyLineStationBackend(runtime, run);

    expect(await backend.launch(spec("t-1"))).toEqual({ ref: "t-1", launched: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({ taskId: "t-1", taskType: "implementation", targetRepo: "o/r", branch: "lore/b" });
    expect(await backend.isActive()).toBe(true);
  });

  it("swallows + logs a background assembly line failure without failing the launch", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn<typeof runFloorAssemblyLineForTask>(async () => {
      throw new Error("boom");
    });
    const backend = new AssemblyLineStationBackend(runtime, run);

    expect(await backend.launch(spec("t-2"))).toEqual({ ref: "t-2", launched: true });
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush the background rejection
    expect(err).toHaveBeenCalledWith(expect.stringContaining("t-2"));
    err.mockRestore();
  });
});
