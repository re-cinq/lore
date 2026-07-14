import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type {
  AssemblyLine,
  SupervisorResult,
} from "@re-cinq/lore-assembly-lines";
import {
  createStartEventHandler,
  type StartEventHandlerDeps,
} from "./start-event-handler.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

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
    station: [] as Array<Record<string, unknown>>,
    detect: [] as Array<Record<string, unknown>>,
    cleanedTokens: [] as string[],
  };
  const deps: StartEventHandlerDeps = {
    cleanupToken: async (taskId) => {
      calls.cleanedTokens.push(taskId);
    },
    assemblyLines: port,
    definitions: async () => TEST_DEFINITIONS,
    runDetect: async (input) => {
      calls.detect.push({ ...input });

      return { ranWork: true, reason: "completed" };
    },
    runOnStation: async (task) => {
      calls.station.push({ ...task });

      return { ranWork: true, reason: "completed" };
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
  it("routes gap-fill to the station path like every other agent line (no in-process path)", async () => {
    const { port, assemblyLineId } = await seededPort("gap-fill");
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(params(assemblyLineId, "gap-fill"));
    await flush();

    expect(calls.station).toEqual([
      {
        assemblyLineId,
        taskId: "task-9",
        pipelineTaskId: "task-9",
        taskType: "gap-fill",
        description: "do the thing",
        targetRepo: "re-cinq/lore",
        branch: "lore/x",
      },
    ]);
    expect(port.rows[0]).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
  });

  it("routes implementation to the station path and closes the row from the supervisor reason", async () => {
    const { port, assemblyLineId } = await seededPort("implementation");
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "implementation"),
    );
    await flush();

    expect(calls.station).toEqual([
      {
        assemblyLineId,
        taskId: "task-9",
        pipelineTaskId: "task-9",
        taskType: "implementation",
        description: "do the thing",
        targetRepo: "re-cinq/lore",
        branch: "lore/x",
      },
    ]);
    expect(port.rows[0]).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
  });

  it("uses the assemblyLineId as the synthetic taskId for a task-less station line", async () => {
    const { port, assemblyLineId } = await seededPort("implementation", null);
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "implementation", null),
    );
    await flush();

    // A task-less line (e.g. code-review) must not collapse to the empty-string taskId —
    // that would key its per-task token/label on "" and race across concurrent runs.
    expect(calls.station[0]).toMatchObject({ taskId: assemblyLineId });
  });

  it("passes pipelineTaskId null for a task-less line and the real task id otherwise", async () => {
    const taskless = await seededPort("implementation", null);
    const taskful = await seededPort("implementation");
    const tasklessCalls = makeDeps(taskless.port);
    const taskfulCalls = makeDeps(taskful.port);

    await createStartEventHandler(tasklessCalls.deps)(
      params(taskless.assemblyLineId, "implementation", null),
    );
    await createStartEventHandler(taskfulCalls.deps)(
      params(taskful.assemblyLineId, "implementation"),
    );
    await flush();

    // The synthetic taskId keys tokens/labels; the lease + audit + Lore-Task trailer
    // need the REAL pipeline.tasks id — a synthetic uuid violates task_leases_task_fk.
    expect(tasklessCalls.calls.station[0]).toMatchObject({
      taskId: taskless.assemblyLineId,
      pipelineTaskId: null,
    });
    expect(taskfulCalls.calls.station[0]).toMatchObject({
      taskId: "task-9",
      pipelineTaskId: "task-9",
    });
  });

  it("reclaims the station line's per-task token once the run finishes", async () => {
    const { port, assemblyLineId } = await seededPort("implementation", null);
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "implementation", null),
    );
    await flush();

    expect(calls.cleanedTokens).toEqual([assemblyLineId]);
  });

  it("returns before the run completes and marks the row running meanwhile", async () => {
    const { port, assemblyLineId } = await seededPort("gap-fill");
    const gate = deferred<SupervisorResult>();
    const { deps } = makeDeps(port, { runOnStation: () => gate.promise });

    await createStartEventHandler(deps)(params(assemblyLineId, "gap-fill"));

    expect(port.rows[0]).toMatchObject({ status: "running" });
    gate.resolve({ ranWork: true, reason: "completed" });
    await flush();
    expect(port.rows[0]).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
  });

  it("routes a definition containing a detect node to runDetect and closes the row from the supervisor reason", async () => {
    const { port, assemblyLineId } = await seededPort("spec-drift", null);
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "spec-drift", null),
    );
    await flush();

    expect(calls.detect).toEqual([
      { assemblyLineId, definitionName: "spec-drift", repo: "re-cinq/lore" },
    ]);
    expect(calls.station).toEqual([]);
    expect(port.rows[0]).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
  });

  it("closes the row as error when runDetect throws", async () => {
    const { port, assemblyLineId } = await seededPort("spec-drift", null);
    const { deps } = makeDeps(port, {
      runDetect: async () => {
        throw new Error("detector exploded");
      },
    });

    await createStartEventHandler(deps)(
      params(assemblyLineId, "spec-drift", null),
    );
    await flush();

    expect(port.rows[0]).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: "detector exploded",
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
    expect(calls.station).toEqual([]);
  });

  it("marks a task-backed single-CR row running without walking (watcher owns its lifecycle)", async () => {
    // Total coverage: single-CR task types (onboard, review, runbook-without-yaml)
    // get an assembly_lines row but no builtin definition. The row is a run record,
    // not a walk — the agent-watcher finishes it when the task's one CR is terminal.
    const { port, assemblyLineId } = await seededPort("onboard");
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(params(assemblyLineId, "onboard"));
    await flush();

    expect(port.rows[0]).toMatchObject({ status: "running", outcome: null });
    expect(calls.station).toEqual([]);
    expect(calls.detect).toEqual([]);
  });

  it("closes the row as error when the station run throws", async () => {
    const { port, assemblyLineId } = await seededPort("gap-fill");
    const { deps } = makeDeps(port, {
      runOnStation: async () => {
        throw new Error("dispatch exploded");
      },
    });

    await createStartEventHandler(deps)(params(assemblyLineId, "gap-fill"));
    await flush();

    expect(port.rows[0]).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: "dispatch exploded",
    });
  });

  it("rejects malformed params (missing assemblyLineId) so the loop retries or dead-letters", async () => {
    const { port } = await seededPort("gap-fill");
    const { deps } = makeDeps(port);

    await expect(
      createStartEventHandler(deps)({
        definitionName: "gap-fill",
        repo: "re-cinq/lore",
      }),
    ).rejects.toThrow(/assemblyLineId/);
  });
});
