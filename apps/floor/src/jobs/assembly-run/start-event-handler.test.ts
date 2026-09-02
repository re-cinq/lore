import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import {
  definitionHash,
  snapshotGraph,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import {
  createStartEventHandler,
  type StartEventHandlerDeps,
} from "./start-event-handler.js";

async function seededPort(
  blueprintName: string,
  taskId: string | null = "task-9",
) {
  const port = new InMemoryAssemblyRuns();
  const assemblyLineId = await port.start({
    blueprintName,
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
  port: InMemoryAssemblyRuns,
  over: Partial<StartEventHandlerDeps> = {},
) {
  const calls = {
    advanced: [] as string[],
  };
  const deps: StartEventHandlerDeps = {
    assemblyRuns: port,
    definitions: async () => TEST_DEFINITIONS,
    advance: async (assemblyLineId) => {
      calls.advanced.push(assemblyLineId);
    },
    ...over,
  };

  return { deps, calls };
}

function params(
  assemblyLineId: string,
  blueprintName: string,
  taskId: string | null = "task-9",
) {
  return {
    assemblyLineId,
    blueprintName,
    repo: "re-cinq/lore",
    branch: "lore/x",
    taskId,
    args: { description: "do the thing" },
  };
}

describe("createStartEventHandler", () => {
  it("a fork's start reopens the settled task behind it before the walk launches", async () => {
    // The source's terminal walk settled the task (usually failed); the fork
    // resumes that work, so the task-keyed surfaces must see it open again.
    const { port, assemblyLineId } = await seededPort("implementation");
    const reopened: string[] = [];
    const { deps, calls } = makeDeps(port, {
      reopenTask: async (row) => {
        reopened.push(`${row.id}:${row.taskId}`);
      },
    });

    await createStartEventHandler(deps)({
      ...params(assemblyLineId, "implementation"),
      resumedFrom: { lineId: "src-run", nodeId: "implement", iteration: 1 },
    });

    expect(reopened).toEqual([`${assemblyLineId}:task-9`]);
    expect(calls.advanced).toEqual([assemblyLineId]);
  });

  it("a plain start reopens nothing — resumedFrom is null", async () => {
    const { port, assemblyLineId } = await seededPort("implementation");
    const reopened: string[] = [];
    const { deps } = makeDeps(port, {
      reopenTask: async (row) => {
        reopened.push(row.id);
      },
    });

    await createStartEventHandler(deps)({
      ...params(assemblyLineId, "implementation"),
      resumedFrom: null,
    });

    expect(reopened).toEqual([]);
  });

  it("marks a station line running and launches its entry node via advance", async () => {
    const { port, assemblyLineId } = await seededPort("implementation");
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "implementation"),
    );

    expect(port.rows[0]).toMatchObject({ status: "running" });
    expect(calls.advanced).toEqual([assemblyLineId]);
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

  it("routes a detect-shaped definition through the same event-driven walk", async () => {
    // Detection lines migrated onto the standard machinery: their detect node is
    // a station CR like any other; job_runs bookkeeping rides args.job_run_id.
    const { port, assemblyLineId } = await seededPort("spec-drift", null);
    const { deps, calls } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "spec-drift", null),
    );

    expect(port.rows[0]).toMatchObject({ status: "running" });
    expect(calls.advanced).toEqual([assemblyLineId]);
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

  it("notifies the failure when a task-less start names an unknown definition", async () => {
    const { port, assemblyLineId } = await seededPort(
      "no-such-definition",
      null,
    );
    const notified: Array<{ id: string; outcome: string }> = [];
    const { deps } = makeDeps(port, {
      notifyFailure: async (row, outcome) => {
        notified.push({ id: row.id, outcome });
      },
    });

    await createStartEventHandler(deps)(
      params(assemblyLineId, "no-such-definition", null),
    );
    // A redelivered event must not notify again — the row is already terminal.
    await createStartEventHandler(deps)(
      params(assemblyLineId, "no-such-definition", null),
    );

    expect(notified).toEqual([{ id: assemblyLineId, outcome: "error" }]);
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
  });

  it("rejects malformed params (missing assemblyRunId) so the loop retries or dead-letters", async () => {
    const { port } = await seededPort("implementation");
    const { deps } = makeDeps(port);

    await expect(
      createStartEventHandler(deps)({ blueprintName: "implementation" }),
    ).rejects.toThrow("missing assemblyRunId");
  });
});

// ── Definition hashing (specs/fork-rerun-from-node FR4): the start handler is
//    the one place that holds both the row id and the resolved definition, so it
//    is where the graph a run executed gets recorded.
describe("createStartEventHandler definition hashing", () => {
  it("stamps the resolved definition's content hash on the row", async () => {
    const { port, assemblyLineId } = await seededPort("implementation");
    const { deps } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "implementation"),
    );

    expect(await port.getById(assemblyLineId)).toMatchObject({
      blueprintHash: definitionHash(
        TEST_DEFINITIONS.get("implementation") as AssemblyLine,
      ),
    });
  });

  it("stamps the CLONE of the resolved blueprint, stations already resolved", async () => {
    // The run must stop depending on a file that can change under it, so the
    // graph it will walk is recorded here, once, beside the hash.
    const { port, assemblyLineId } = await seededPort("implementation");
    const { deps } = makeDeps(port);

    await createStartEventHandler(deps)(
      params(assemblyLineId, "implementation"),
    );

    expect((await port.getById(assemblyLineId))?.graph).toEqual(
      snapshotGraph(
        TEST_DEFINITIONS.get("implementation") as AssemblyLine,
        "implementation",
      ),
    );
  });

  it("leaves an earlier stamp alone when a redelivered start loads an edited definition", async () => {
    const { port, assemblyLineId } = await seededPort("implementation");
    const edited = new Map(TEST_DEFINITIONS);

    edited.set("implementation", definition("implementation", ["agent"]));
    const first = makeDeps(port);

    await createStartEventHandler(first.deps)(
      params(assemblyLineId, "implementation"),
    );
    const original = (await port.getById(assemblyLineId))?.blueprintHash;
    const second = makeDeps(port, { definitions: async () => edited });

    await createStartEventHandler(second.deps)(
      params(assemblyLineId, "implementation"),
    );

    expect(await port.getById(assemblyLineId)).toMatchObject({
      blueprintHash: original,
    });
  });

  it("stamps nothing when the definition does not resolve", async () => {
    const { port, assemblyLineId } = await seededPort("onboard");
    const { deps } = makeDeps(port);

    await createStartEventHandler(deps)(params(assemblyLineId, "onboard"));

    expect(await port.getById(assemblyLineId)).toMatchObject({
      blueprintHash: null,
    });
  });
});
