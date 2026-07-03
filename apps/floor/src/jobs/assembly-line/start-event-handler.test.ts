import { describe, it, expect, vi } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import { createStartEventHandler, type StartEventHandlerDeps } from "./start-event-handler.js";

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

async function seededPort(definitionName: string, taskId = "task-9") {
  const port = new InMemoryAssemblyLines();
  const assemblyLineId = await port.start({
    definitionName,
    repo: "re-cinq/lore",
    branch: "lore/x",
    taskId,
    args: { description: "do the thing" },
  });
  return { port, assemblyLineId };
}

function makeDeps(port: InMemoryAssemblyLines, over: Partial<StartEventHandlerDeps> = {}) {
  const calls = {
    inProcess: [] as Array<Record<string, unknown>>,
    station: [] as Array<Record<string, unknown>>,
    taskOutcomes: [] as Array<{ taskId: string; outcome: string }>,
  };
  const deps: StartEventHandlerDeps = {
    assemblyLines: port,
    knownDefinitions: async () => new Set(["gap-fill", "runbook", "implementation", "general"]),
    runInProcess: async (input) => {
      calls.inProcess.push({ ...input });
      return { outcome: "pr_created", prUrl: "https://pr", prNumber: 7 };
    },
    runOnStation: async (task) => {
      calls.station.push({ ...task });
      return { ranWork: true, reason: "completed" };
    },
    applyTaskOutcome: async (taskId, result) => {
      calls.taskOutcomes.push({ taskId, outcome: result.outcome });
    },
    ...over,
  };
  return { deps, calls };
}

function params(assemblyLineId: string, definitionName: string, taskId: string | null = "task-9") {
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
  it("routes gap-fill in-process with the threaded assemblyLineId and closes row + task on completion", async () => {
    const { port, assemblyLineId } = await seededPort("gap-fill");
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(params(assemblyLineId, "gap-fill"));
    await flush();

    expect(calls.inProcess).toEqual([
      {
        assemblyLineId,
        taskId: "task-9",
        description: "do the thing",
        taskType: "gap-fill",
        repo: "re-cinq/lore",
        branch: "lore/x",
      },
    ]);
    expect(calls.station).toEqual([]);
    expect(port.rows[0]).toMatchObject({ status: "finished", outcome: "pr_created" });
    expect(calls.taskOutcomes).toEqual([{ taskId: "task-9", outcome: "pr_created" }]);
  });

  it("routes implementation to the station path and closes the row from the supervisor reason", async () => {
    const { port, assemblyLineId } = await seededPort("implementation");
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(params(assemblyLineId, "implementation"));
    await flush();

    expect(calls.inProcess).toEqual([]);
    expect(calls.station).toEqual([
      {
        assemblyLineId,
        taskId: "task-9",
        taskType: "implementation",
        description: "do the thing",
        targetRepo: "re-cinq/lore",
        branch: "lore/x",
      },
    ]);
    expect(port.rows[0]).toMatchObject({ status: "finished", outcome: "completed" });
    // Task status on the station path belongs to the agent-watcher, not the handler.
    expect(calls.taskOutcomes).toEqual([]);
  });

  it("returns before the run completes and marks the row running meanwhile", async () => {
    const { port, assemblyLineId } = await seededPort("gap-fill");
    const gate = deferred<{ outcome: "no_changes" }>();
    const { deps } = makeDeps(port, { runInProcess: () => gate.promise });

    await createStartEventHandler(deps)(params(assemblyLineId, "gap-fill"));

    expect(port.rows[0]).toMatchObject({ status: "running" });
    gate.resolve({ outcome: "no_changes" });
    await flush();
    expect(port.rows[0]).toMatchObject({ status: "finished", outcome: "no_changes" });
  });

  it("marks the row failed and resolves on an unknown definition (no retry, nothing run)", async () => {
    const { port, assemblyLineId } = await seededPort("no-such-definition");
    const { deps, calls } = makeDeps(port);

    await expect(
      createStartEventHandler(deps)(params(assemblyLineId, "no-such-definition")),
    ).resolves.toBeUndefined();

    expect(port.rows[0]).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: 'no assembly line defined for task type "no-such-definition"',
    });
    expect(calls.inProcess).toEqual([]);
    expect(calls.station).toEqual([]);
  });

  it("closes the row as error and fails the task when the in-process run throws", async () => {
    const { port, assemblyLineId } = await seededPort("gap-fill");
    const { deps, calls } = makeDeps(port, {
      runInProcess: async () => {
        throw new Error("clone exploded");
      },
    });

    await createStartEventHandler(deps)(params(assemblyLineId, "gap-fill"));
    await flush();

    expect(port.rows[0]).toMatchObject({ status: "failed", outcome: "error", reason: "clone exploded" });
    expect(calls.taskOutcomes).toEqual([{ taskId: "task-9", outcome: "error" }]);
  });

  it("rejects malformed params (missing assemblyLineId) so the loop retries or dead-letters", async () => {
    const { port } = await seededPort("gap-fill");
    const { deps } = makeDeps(port);

    await expect(
      createStartEventHandler(deps)({ definitionName: "gap-fill", repo: "re-cinq/lore" }),
    ).rejects.toThrow(/assemblyLineId/);
  });
});
