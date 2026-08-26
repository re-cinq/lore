// Readers-first compat for the assembly_run.* params key (#1270): every handler
// accepts `params.assemblyRunId` BEFORE any writer emits it, so the writer flip
// can ship once this accept half is deployed; rows queued by the old image keep
// working through the `assemblyLineId` fallback. A separate file on purpose —
// appending to the anchored handler suites would shift their spec #Lnn anchors.
import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import {
  parseAssemblyLine,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import { createStartEventHandler } from "./start-event-handler.js";
import { createResumeEventHandler } from "./resume-event-handler.js";
import { createNodeEventHandler } from "./node-event-handler.js";

const twoNodeLine: AssemblyLine = parseAssemblyLine(`
name: implementation
description: agent → retro
version: 1
entry: work
exit: retro
nodes:
  - id: work
    type: agent
    prompt_ref: implementation
  - id: retro
    type: retrospective
edges:
  - from: work
    to: retro
    on: always
`);

describe("assembly_run.* params accept assemblyRunId with assemblyLineId fallback", () => {
  it("start handler resolves the run from params.assemblyRunId, new key winning", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "implementation",
      repo: "o/r",
      branch: "b",
      taskId: "task-9",
      args: { description: "d" },
    });
    const advanced: string[] = [];
    const handler = createStartEventHandler({
      assemblyRuns: port,
      definitions: async () => new Map([["implementation", twoNodeLine]]),
      advance: async (assemblyLineId) => {
        advanced.push(assemblyLineId);
      },
    });

    await handler({
      assemblyRunId: id,
      assemblyLineId: "ffffffff-0000-0000-0000-000000000000",
      blueprintName: "implementation",
      repo: "o/r",
      branch: "b",
      taskId: "task-9",
    });

    expect(advanced).toEqual([id]);
    expect((await port.getById(id))?.status).toBe("running");
  });

  it("resume handler resolves the parked node from params.assemblyRunId", async () => {
    const port = new InMemoryAssemblyRuns();
    const finished: Array<{ assemblyLineId: string; nodeId: string }> = [];
    const handler = createResumeEventHandler({
      assemblyRuns: port,
      finishNodeAndAdvance: async (input) => {
        finished.push({
          assemblyLineId: input.assemblyLineId,
          nodeId: input.nodeId,
        });
      },
    });

    await handler({
      assemblyRunId: "11111111-2222-3333-4444-555555555555",
      nodeId: "author",
      iteration: 1,
      outcome: "success",
    });

    expect(finished).toEqual([
      {
        assemblyLineId: "11111111-2222-3333-4444-555555555555",
        nodeId: "author",
      },
    ]);
  });

  it("node handler resolves the run row from params.assemblyRunId", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "implementation",
      repo: "o/r",
      branch: "b",
      args: { description: "d" },
    });

    await port.markRunning(id);
    const crName = `${id.substring(0, 12)}-work`;

    await port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "work",
      iteration: 1,
      agentCrName: crName,
    });
    const handler = createNodeEventHandler({
      assemblyRuns: port,
      definitions: async () => new Map([["implementation", twoNodeLine]]),
      repoSettings: async () => null,
      resolvePrompt: (ref) => `prompt:${ref}`,
      cleanupToken: async () => {},
      jobRuns: { complete: async () => {}, fail: async () => {} },
      readAgentStatus: async () => ({ phase: "Succeeded", output: "" }),
    });

    await handler({
      assemblyRunId: id,
      nodeId: "work",
      agentName: crName,
      iteration: 1,
      phase: "Succeeded",
    });

    const nodes = await port.listStationRuns(id);

    expect(
      nodes.map((n) => ({ nodeId: n.nodeId, outcome: n.outcome })),
    ).toEqual(expect.arrayContaining([{ nodeId: "work", outcome: "success" }]));
  });
});
