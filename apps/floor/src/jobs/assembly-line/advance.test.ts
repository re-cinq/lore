import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import {
  advanceLine,
  finishNodeAndAdvance,
  taskFromRow,
  type AdvanceDeps,
} from "./advance.js";

const codeReviewLike: AssemblyLine = parseAssemblyLine(`
name: code-review
description: review → refine → done
version: 1
entry: review
exit: done
nodes:
  - id: review
    type: agent
    prompt_ref: code-review
  - id: refine
    type: agent
    prompt_ref: code-review-refine
  - id: done
    type: retrospective
edges:
  - from: review
    to: refine
    on: changes_requested
  - from: review
    to: done
    on: success
  - from: review
    to: done
    on: failed
  - from: refine
    to: done
    on: always
`);

function makeDeps(port: InMemoryAssemblyLines) {
  const launched: LoreTaskSpec[] = [];
  const cleaned: string[] = [];
  const deps: AdvanceDeps = {
    assemblyLines: port,
    definitions: async () =>
      new Map<string, AssemblyLine>([["code-review", codeReviewLike]]),
    launch: async (spec) => {
      launched.push(spec);
    },
    resolvePrompt: (promptRef, description) => `${promptRef}::${description}`,
    cleanupToken: async (runTaskId) => {
      cleaned.push(runTaskId);
    },
  };

  return { deps, launched, cleaned };
}

async function runningLine(port: InMemoryAssemblyLines) {
  const id = await port.start({
    definitionName: "code-review",
    repo: "re-cinq/lore",
    branch: "feat/x",
    args: { description: "Review pull request #7", pr_number: 7 },
  });

  await port.markRunning(id);

  return id;
}

describe("advanceLine", () => {
  it("launches the entry node CR with the row's description in the prompt", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, deps);

    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({
      name: `${id.substring(0, 8)}-review`,
      taskType: "code-review",
      prompt: "code-review::Review pull request #7",
      branch: "feat/x",
    });
    expect(port.nodes).toEqual([
      expect.objectContaining({ nodeId: "review", iteration: 1 }),
    ]);
  });

  it("converges a duplicate advance onto one node row and one idempotent launch", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, deps);
    await advanceLine(id, deps);

    expect(port.nodes).toHaveLength(1);
    // Both advances launch the SAME deterministic CR name — the 409 makes the
    // second a no-op at the cluster; the walk state stays single-rowed.
    expect(new Set(launched.map((l) => l.name)).size).toBe(1);
  });

  it("does nothing while the newest node row is still open", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, deps);
    launched.length = 0;
    await advanceLine(id, deps);

    expect(launched).toEqual([]);
  });

  it("finishes the row completed and reclaims the token when the walk reaches exit", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps, cleaned } = makeDeps(port);

    await advanceLine(id, deps);
    const nodeRowId = port.nodes[0]!.id;

    await port.finishNodeOnce(nodeRowId, "success");
    await advanceLine(id, deps);

    expect(await port.getById(id)).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
    expect(cleaned).toEqual([id]);
  });

  it("skips rows that are not running and unknown definitions", async () => {
    const port = new InMemoryAssemblyLines();
    const queued = await port.start({
      definitionName: "code-review",
      repo: "o/r",
    });
    const singleCr = await port.start({
      definitionName: "runbook",
      repo: "o/r",
      taskId: "task-1",
    });

    await port.markRunning(singleCr);
    const { deps, launched } = makeDeps(port);

    await advanceLine(queued, deps);
    await advanceLine(singleCr, deps);

    expect(launched).toEqual([]);
  });
});

describe("finishNodeAndAdvance", () => {
  it("records the outcome and launches the next node per the definition", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        result: { outcome: "changes_requested" },
      },
      deps,
    );

    expect(port.nodes.map((n) => [n.nodeId, n.outcome])).toEqual([
      ["review", "changes_requested"],
      ["refine", null],
    ]);
    expect(launched.at(-1)).toMatchObject({
      name: `${id.substring(0, 8)}-refine`,
    });
  });

  it("keeps the stored outcome when a duplicate event races the first writer", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      { assemblyLineId: id, nodeId: "review", result: { outcome: "success" } },
      deps,
    );
    await finishNodeAndAdvance(
      { assemblyLineId: id, nodeId: "review", result: { outcome: "failed" } },
      deps,
    );

    expect(port.nodes[0]).toMatchObject({ outcome: "success" });
    expect(await port.getById(id)).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
  });
});

describe("taskFromRow", () => {
  it("derives the synthetic taskId for a task-less row and keeps the real one otherwise", async () => {
    const port = new InMemoryAssemblyLines();
    const taskless = await port.start({
      definitionName: "code-review",
      repo: "o/r",
      args: { description: "d" },
    });
    const rowless = (await port.getById(taskless))!;

    expect(taskFromRow(rowless)).toMatchObject({
      taskId: taskless,
      pipelineTaskId: null,
      assemblyLineId: taskless,
      description: "d",
    });

    const taskful = await port.start({
      definitionName: "implementation",
      repo: "o/r",
      taskId: "task-9",
    });

    expect(taskFromRow((await port.getById(taskful))!)).toMatchObject({
      taskId: "task-9",
      pipelineTaskId: "task-9",
    });
  });
});
