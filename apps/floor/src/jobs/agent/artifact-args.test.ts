import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { argNameForEvent, deliverArtifact } from "./artifact-args.js";
import type { AgentFileEvent } from "./agent-events.js";

const fileEvent = (over: Partial<AgentFileEvent> = {}): AgentFileEvent => ({
  taskId: "task-1",
  agentCrName: "abc123456789-analyse",
  event: "spec.plan",
  path: "target/spec-plan.json",
  content: '{"changes":[]}',
  reason: null,
  ...over,
});

async function lineFor(lines: InMemoryAssemblyRuns): Promise<string> {
  const id = await lines.start({
    blueprintName: "feature-finalize",
    repo: "re-cinq/lore",
    branch: "spec/x",
    taskId: "task-1",
    args: { description: "d" },
  });

  await lines.markRunning(id);

  return id;
}

describe("argNameForEvent", () => {
  it("turns a dotted event name into an arg name", () => {
    expect(argNameForEvent("spec.plan")).toBe("spec_plan");
  });

  it("flattens every separator so an arg name is always a plain key", () => {
    expect(argNameForEvent("feature.decomposition-v2")).toBe(
      "feature_decomposition_v2",
    );
  });
});

describe("deliverArtifact", () => {
  it("merges a produced artifact into its line's args under the event's name", async () => {
    const lines = new InMemoryAssemblyRuns();
    const id = await lineFor(lines);

    expect(await deliverArtifact(fileEvent(), { assemblyRuns: lines })).toEqual(
      { outcome: "merged", arg: "spec_plan" },
    );
    expect((await lines.getById(id))?.args).toMatchObject({
      description: "d",
      spec_plan: '{"changes":[]}',
    });
  });

  it("leaves the planning result to its own handler", async () => {
    // deliverPlanningResult posts it to the features API — a different destination,
    // and merging it into args as well would duplicate a whole GapResult per round.
    const lines = new InMemoryAssemblyRuns();

    await lineFor(lines);

    expect(
      await deliverArtifact(fileEvent({ event: "planning.result" }), {
        assemblyRuns: lines,
      }),
    ).toMatchObject({ outcome: "skipped" });
  });

  it("merges nothing when the agent never produced the artifact", async () => {
    // The node's own outcome already reports this; there is no content to carry.
    const lines = new InMemoryAssemblyRuns();
    const id = await lineFor(lines);

    await deliverArtifact(fileEvent({ content: null, reason: "missing" }), {
      assemblyRuns: lines,
    });

    expect((await lines.getById(id))?.args).not.toHaveProperty("spec_plan");
  });

  it("merges into the NEWEST line for the task, so a re-dispatch wins", async () => {
    const lines = new InMemoryAssemblyRuns();

    await lineFor(lines);
    const second = await lineFor(lines);

    await deliverArtifact(fileEvent(), { assemblyRuns: lines });

    expect((await lines.getById(second))?.args).toMatchObject({
      spec_plan: '{"changes":[]}',
    });
  });

  it("skips an artifact from a run with no assembly line", async () => {
    const lines = new InMemoryAssemblyRuns();

    expect(
      await deliverArtifact(fileEvent(), { assemblyRuns: lines }),
    ).toMatchObject({ outcome: "skipped" });
  });
});
