import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { AssemblyLineStationBackend } from "./assembly-line-station-backend.js";

function spec(taskId: string): LoreTaskSpec {
  return {
    taskId,
    taskType: "implementation",
    description: "implement the thing",
    prompt: "p",
    targetRepo: "o/r",
    branch: "lore/b",
  };
}

describe("AssemblyLineStationBackend", () => {
  it("launch starts the assembly line (row + start event) and returns its id as the ref", async () => {
    const port = new InMemoryAssemblyLines();
    const backend = new AssemblyLineStationBackend(port);

    const result = await backend.launch(spec("t-1"));

    expect(result.launched).toBe(true);
    expect(port.rows).toMatchObject([
      {
        id: result.ref,
        definitionName: "implementation",
        repo: "o/r",
        branch: "lore/b",
        taskId: "t-1",
        status: "queued",
      },
    ]);
    expect(port.events).toMatchObject([
      {
        eventName: "assembly_line.start",
        dedupeKey: `assembly_line.start:${result.ref}`,
      },
    ]);
    expect(await backend.isActive()).toBe(true);
  });

  it("two launches of the same task mint distinct assembly line ids", async () => {
    const port = new InMemoryAssemblyLines();
    const backend = new AssemblyLineStationBackend(port);

    const first = await backend.launch(spec("t-1"));
    const second = await backend.launch(spec("t-1"));

    expect(first.ref).not.toBe(second.ref);
    expect(port.rows).toHaveLength(2);
  });
});
