import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import {
  argNameForEvent,
  argsForArtifact,
  artifactsFromTerminalOutput,
  deliverArtifact,
} from "./artifact-args.js";
import type { AgentFileEvent } from "./agent-events.js";

const fileEvent = (over: Partial<AgentFileEvent> = {}): AgentFileEvent => ({
  taskId: "task-1",
  agentCrName: "abc123456789-analyse",
  event: "spec.plan",
  path: "target/spec-plan.json",
  content: '{"changes":[]}',
  reason: null,
  uploaded: false,
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

  it("leaves the planning result to deliverPlanningResult, which writes it into the plan instead of duplicating it into args", async () => {
    const lines = new InMemoryAssemblyRuns();

    await lineFor(lines);

    expect(
      await deliverArtifact(fileEvent({ event: "planning.result" }), {
        assemblyRuns: lines,
      }),
    ).toMatchObject({ outcome: "skipped" });
  });

  it("merges nothing when the agent never produced the artifact, since the node's own outcome already reports it", async () => {
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

describe("artifactsFromTerminalOutput", () => {
  const fileLine = (over: Record<string, unknown>) =>
    JSON.stringify({
      source: { task: "t1" },
      event: {
        kind: "file",
        event: "spec.plan",
        path: "target/x.json",
        ...over,
      },
    });

  it("reads the declared artifacts out of a terminal status, so delivery rides the advancing event instead of racing the separate artifact-sink HTTP post", () => {
    expect(
      artifactsFromTerminalOutput(
        `{"type":"log","message":"working"}\n${fileLine({ content: '{"updates":[]}' })}`,
      ),
    ).toEqual({
      args: { spec_plan: '{"updates":[]}' },
      missing: [],
    });
  });

  it("names an artifact the agent declared and never produced, rather than advancing without it", () => {
    expect(
      artifactsFromTerminalOutput(
        fileLine({ content: null, reason: "file not found" }),
      ),
    ).toEqual({
      args: {},
      missing: ["spec.plan (file not found)"],
    });
  });

  it("leaves the planning result to the handler that owns it", () => {
    expect(
      artifactsFromTerminalOutput(
        fileLine({ event: "planning.result", content: "{}" }),
      ),
    ).toEqual({ args: {}, missing: [] });
  });

  it("fails the pass whose plan.md upload failed, though the planning file is written by another handler", () => {
    expect(
      artifactsFromTerminalOutput(
        fileLine({
          event: "planning.result",
          path: "plan.md",
          content: null,
          reason: "upload-failed",
        }),
      ),
    ).toEqual({ args: {}, missing: ["planning.result (upload-failed)"] });
  });

  it("counts an uploaded file as delivered, carrying no content of its own", () => {
    expect(
      artifactsFromTerminalOutput(
        fileLine({
          event: "planning.result",
          path: "plan.md",
          content: null,
          uploaded: true,
        }),
      ),
    ).toEqual({ args: {}, missing: [] });
  });

  it("finds nothing in a status that carries no artifacts at all", () => {
    expect(artifactsFromTerminalOutput(undefined)).toEqual({
      args: {},
      missing: [],
    });
    expect(artifactsFromTerminalOutput("plain text, not ndjson")).toEqual({
      args: {},
      missing: [],
    });
  });
});

describe("argsForArtifact", () => {
  it("names spec_path after the first spec a spec plan creates", () => {
    const plan = {
      creates: [{ path: "specs/checkout/spec.md" }],
      updates: [{ path: "specs/cart/spec.md" }],
    };

    expect(argsForArtifact("spec.plan", JSON.stringify(plan))).toEqual({
      spec_plan: JSON.stringify(plan),
      spec_path: "specs/checkout/spec.md",
    });
  });

  it("names spec_path after the first spec a spec plan updates when it creates none", () => {
    const plan = { creates: [], updates: [{ path: "specs/cart/spec.md" }] };

    expect(argsForArtifact("spec.plan", JSON.stringify(plan))).toMatchObject({
      spec_path: "specs/cart/spec.md",
    });
  });

  it("carries any other artifact under its own name only", () => {
    expect(argsForArtifact("feature.decomposition", "{}")).toEqual({
      feature_decomposition: "{}",
    });
  });

  it("names no spec_path for a spec plan that is not JSON", () => {
    expect(argsForArtifact("spec.plan", "{oops")).toEqual({
      spec_plan: "{oops",
    });
  });
});
