import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type { AssemblyLine } from "@re-cinq/lore-assembly-lines";
import {
  createStartEventHandler,
  type StartEventHandlerDeps,
} from "./start-event-handler.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function seededPort(
  definitionName: string,
  taskId: string | null = "task-9",
) {
  const port = new InMemoryAssemblyLines();
  const assemblyLineId = await port.start({
    definitionName,
    repo: "re-cinq/lore",
    branch: "lore/x",
    taskId: taskId ?? undefined,
    args: { description: "do the thing" },
  });

  return { port, assemblyLineId };
}

/** Minimal loaded definition — just enough shape for routing decisions. */
function definition(name: string, nodeTypes: string[]): AssemblyLine {
  const nodes = nodeTypes.map((type, i) => ({
    id: `n${i}`,
    type,
    ...(type === "detect" ? { job_ref: "spec_drift" } : {}),
  })) as AssemblyLine["nodes"];

  return {
    name,
    description: "test fixture",
    version: 1,
    entry: "n0",
    exit: `n${nodeTypes.length - 1}`,
    nodes,
    edges: [],
  };
}

const TEST_DEFINITIONS = new Map<string, AssemblyLine>([
  ["gap-fill", definition("gap-fill", ["agent", "retrospective"])],
  ["runbook", definition("runbook", ["agent", "retrospective"])],
  ["implementation", definition("implementation", ["agent", "retrospective"])],
  ["general", definition("general", ["agent", "retrospective"])],
  ["spec-drift", definition("spec-drift", ["detect", "retrospective"])],
]);

function makeDeps(
  port: InMemoryAssemblyLines,
  over: Partial<StartEventHandlerDeps> = {},
) {
  const calls = {
    advanced: [] as string[],
    detect: [] as Array<Record<string, unknown>>,
  };
  const deps: StartEventHandlerDeps = {
    assemblyLines: port,
    definitions: async () => TEST_DEFINITIONS,
    runDetect: async (input) => {
      calls.detect.push({ ...input });

      return { ranWork: true, reason: "completed" };
    },
    advance: async (assemblyLineId) => {
      calls.advanced.push(assemblyLineId);
    },
    ...over,
  };

  return { deps, calls };
}

function params(
  assemblyLineId: string,
  definitionName: string,
  taskId: string | null = "task-9",
) {
  return {
    assemblyLineId,
    definitionName,
    repo: "re-cinq/lore",
    branch: "lore/x",
    taskId,
    args: { description: "do the thing" },
  };
}

describe("createStartEventHandler", () => {
  it("marks a station line running and launches its entry node via advance", async () => {
    const { port, assemblyLineId } = await seededPort("implementation");
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "implementation"),
    );

    expect(port.rows[0]).toMatchObject({ status: "running" });
    expect(calls.advanced).toEqual([assemblyLineId]);
    expect(calls.detect).toEqual([]);
  });

  it("advances a task-less station line the same way (code-review shape)", async () => {
    const { port, assemblyLineId } = await seededPort("gap-fill", null);
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "gap-fill", null),
    );

    expect(port.rows[0]).toMatchObject({ status: "running" });
    expect(calls.advanced).toEqual([assemblyLineId]);
  });

  it("rejects when the entry launch fails so the event loop retries (advance is idempotent)", async () => {
    const { port, assemblyLineId } = await seededPort("implementation");
    const { deps } = makeDeps(port, {
      advance: async () => {
        throw new Error("kube API unavailable");
      },
    });

    await expect(
      createStartEventHandler(deps)(params(assemblyLineId, "implementation")),
    ).rejects.toThrow("kube API unavailable");

    // The row stays running — the retried event re-runs markRunning + advance.
    expect(port.rows[0]).toMatchObject({ status: "running" });
  });

  it("routes a definition containing a detect node to runDetect and closes the row from the supervisor reason", async () => {
    const { port, assemblyLineId } = await seededPort("spec-drift", null);
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "spec-drift", null),
    );
    await flush();

    expect(calls.detect).toEqual([
      {
        assemblyLineId,
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
      },
    ]);
    expect(calls.advanced).toEqual([]);
    expect(port.rows[0]).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
  });

  it("closes the row as error when runDetect throws", async () => {
    const { port, assemblyLineId } = await seededPort("spec-drift", null);
    const { deps } = makeDeps(port, {
      runDetect: async () => {
        throw new Error("detect exploded");
      },
    });

    await createStartEventHandler(deps)(
      params(assemblyLineId, "spec-drift", null),
    );
    await flush();

    expect(port.rows[0]).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: "detect exploded",
    });
  });

  it("marks a task-less row failed and resolves on an unknown definition (no retry, nothing run)", async () => {
    const { port, assemblyLineId } = await seededPort(
      "no-such-definition",
      null,
    );
    const { deps, calls } = makeDeps(port);

    await expect(
      createStartEventHandler(deps)(
        params(assemblyLineId, "no-such-definition", null),
      ),
    ).resolves.toBeUndefined();

    expect(port.rows[0]).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: 'no assembly line defined for task type "no-such-definition"',
    });
    expect(calls.advanced).toEqual([]);
  });

  it("marks a task-backed single-CR row running without walking (watcher owns its lifecycle)", async () => {
    // Total coverage: single-CR task types (onboard, review, runbook-without-yaml)
    // get an assembly_lines row but no builtin definition. The row is a run record,
    // not a walk — the agent-watcher finishes it when the task's one CR is terminal.
    const { port, assemblyLineId } = await seededPort("onboard");
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(params(assemblyLineId, "onboard"));

    expect(port.rows[0]).toMatchObject({ status: "running", outcome: null });
    expect(calls.advanced).toEqual([]);
    expect(calls.detect).toEqual([]);
  });

  it("rejects malformed params (missing assemblyLineId) so the loop retries or dead-letters", async () => {
    const { port } = await seededPort("implementation");
    const { deps } = makeDeps(port);

    await expect(
      createStartEventHandler(deps)({ definitionName: "implementation" }),
    ).rejects.toThrow("missing assemblyLineId");
  });
});
