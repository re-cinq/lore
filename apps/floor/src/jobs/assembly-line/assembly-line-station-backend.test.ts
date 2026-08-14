import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
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
    const port = new InMemoryAssemblyRuns();
    const backend = new AssemblyLineStationBackend(port);

    const result = await backend.launch(spec("t-1"));

    expect(result.launched).toBe(true);
    expect(port.rows).toMatchObject([
      {
        id: result.ref,
        blueprintName: "implementation",
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

  it("threads the feature id into the line's args so a thread key can name it", async () => {
    // `continues.key: args.feature_id` resolves against these args — the engine
    // never learns what a feature is, it just carries what the caller put here.
    const port = new InMemoryAssemblyRuns();
    const backend = new AssemblyLineStationBackend(port);

    await backend.launch({ ...spec("t1"), featureId: "feature-9" });

    expect(port.rows[0].args).toMatchObject({ feature_id: "feature-9" });
  });

  it("threads the round-feedback turn so a resumed run can send only what is new", async () => {
    const port = new InMemoryAssemblyRuns();
    const backend = new AssemblyLineStationBackend(port);

    await backend.launch({
      ...spec("t1"),
      roundFeedback: '<RoundFeedback round="4"/>',
      resumeFromTask: "task-round-1",
    });

    expect(port.rows[0].args).toMatchObject({
      round_feedback: '<RoundFeedback round="4"/>',
      // The round the conversation is resumed FROM, which rewind names explicitly.
      resume_from_task: "task-round-1",
    });
  });

  it("carries no feature id for a run that has none", async () => {
    const port = new InMemoryAssemblyRuns();
    const backend = new AssemblyLineStationBackend(port);

    await backend.launch(spec("t1"));

    expect(port.rows[0].args).not.toHaveProperty("feature_id");
    expect(port.rows[0].args).not.toHaveProperty("round_feedback");
  });

  it("two launches of the same task mint distinct assembly line ids", async () => {
    const port = new InMemoryAssemblyRuns();
    const backend = new AssemblyLineStationBackend(port);

    const first = await backend.launch(spec("t-1"));
    const second = await backend.launch(spec("t-1"));

    expect(first.ref).not.toBe(second.ref);
    expect(port.rows).toHaveLength(2);
  });
});
