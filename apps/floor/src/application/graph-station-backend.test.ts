import { describe, it, expect, vi } from "vitest";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { GraphStationBackend } from "./graph-station-backend.js";
import type { runFloorGraphForTask, FloorGraphRuntime } from "./floor-graph-run.js";
import type { FloorGraphTask } from "./floor-graph.js";

const runtime = {} as FloorGraphRuntime;
const spec = (taskId: string): LoreTaskSpec => ({
  taskId,
  taskType: "implementation",
  description: "d",
  prompt: "p",
  targetRepo: "o/r",
  branch: "lore/b",
});

describe("GraphStationBackend", () => {
  it("fires the graph in the background and returns launched immediately", async () => {
    const seen: FloorGraphTask[] = [];
    const run = vi.fn<typeof runFloorGraphForTask>(async (task) => {
      seen.push(task);
      return { ranWork: true, reason: "completed" };
    });
    const backend = new GraphStationBackend(runtime, run);

    expect(await backend.launch(spec("t-1"))).toEqual({ ref: "t-1", launched: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({ taskId: "t-1", taskType: "implementation", targetRepo: "o/r", branch: "lore/b" });
    expect(await backend.isActive()).toBe(true);
  });

  it("swallows + logs a background graph failure without failing the launch", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn<typeof runFloorGraphForTask>(async () => {
      throw new Error("boom");
    });
    const backend = new GraphStationBackend(runtime, run);

    expect(await backend.launch(spec("t-2"))).toEqual({ ref: "t-2", launched: true });
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush the background rejection
    expect(err).toHaveBeenCalledWith(expect.stringContaining("t-2"));
    err.mockRestore();
  });
});
