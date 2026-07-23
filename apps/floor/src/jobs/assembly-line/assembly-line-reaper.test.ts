import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import {
  assemblyLineReaperJob,
  decideNodeRecovery,
} from "./assembly-line-reaper.js";

const line: AssemblyLine = parseAssemblyLine(`
name: code-review
description: review → done
version: 1
entry: review
exit: done
nodes:
  - id: review
    type: agent
    prompt_ref: code-review
    timeout_minutes: 15
  - id: done
    type: retrospective
edges:
  - from: review
    to: done
    on: success
  - from: review
    to: done
    on: failed
`);

const MIN = 60_000;

describe("decideNodeRecovery", () => {
  const node = (ageMinutes: number) => ({
    id: "1",
    assemblyLineId: "al-1",
    nodeId: "review",
    iteration: 1,
    outcome: null,
    agentCrName: "a1b2c3d4-review",
    commitSha: null,
    startedAt: new Date(Date.now() - ageMinutes * MIN),
    finishedAt: null,
  });
  const nowMs = Date.now();

  it("resolves a terminal CR whose event was dropped", () => {
    const status: AgentNodeStatus = {
      phase: "Succeeded",
      output: "REVIEW_RESULT:APPROVED",
    };

    expect(
      decideNodeRecovery({ node: node(5), timeoutMinutes: 15, status, nowMs }),
    ).toEqual({ kind: "resolve", status });
  });

  it("relaunches a fresh open node whose CR is missing (crash between row and launch)", () => {
    expect(
      decideNodeRecovery({
        node: node(3),
        timeoutMinutes: 15,
        status: null,
        nowMs,
      }),
    ).toEqual({ kind: "relaunch" });
  });

  it("times out an open node past its budget, CR present or not", () => {
    expect(
      decideNodeRecovery({
        node: node(20),
        timeoutMinutes: 15,
        status: null,
        nowMs,
      }),
    ).toEqual({ kind: "timeout" });
    expect(
      decideNodeRecovery({
        node: node(20),
        timeoutMinutes: 15,
        status: { phase: "Running" },
        nowMs,
      }),
    ).toEqual({ kind: "timeout" });
  });

  it("waits on a live in-budget CR", () => {
    expect(
      decideNodeRecovery({
        node: node(5),
        timeoutMinutes: 15,
        status: { phase: "Running" },
        nowMs,
      }),
    ).toEqual({ kind: "wait" });
  });
});

function harness() {
  const port = new InMemoryAssemblyLines();
  const launched: LoreTaskSpec[] = [];
  const statusByName: Record<string, AgentNodeStatus | null> = {};
  const taskStatusById: Record<string, string | null> = {};

  const deps = {
    assemblyLines: port,
    definitions: async () => new Map([["code-review", line]]),
    launch: async (spec: LoreTaskSpec) => {
      launched.push(spec);
    },
    resolvePrompt: (ref: string) => `prompt:${ref}`,
    cleanupToken: async () => {},
    jobRuns: { complete: async () => {}, fail: async () => {} },
    readAgentStatus: async (name: string) => statusByName[name] ?? null,
    taskStatus: async (taskId: string) => taskStatusById[taskId] ?? null,
  };

  return { port, launched, statusByName, taskStatusById, deps };
}

describe("assemblyLineReaperJob", () => {
  it("resolves a dropped terminal event and advances the line to completion", async () => {
    const h = harness();
    const id = await h.port.start({
      definitionName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    const crName = `${id.substring(0, 12)}-review`;

    await h.port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: crName,
    });
    h.statusByName[crName] = {
      phase: "Succeeded",
      output: "REVIEW_RESULT:APPROVED",
    };

    const summary = await assemblyLineReaperJob(h.deps);

    expect(await h.port.getById(id)).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
    expect(summary).toContain("resolved 1");
  });

  it("fails a timed-out node as agent-timeout and routes the failed edge", async () => {
    const h = harness();
    const id = await h.port.start({
      definitionName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    const old = new Date(Date.now() - 30 * MIN);
    const clock = h.port.clock;

    h.port.clock = () => old;
    await h.port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
    });
    h.port.clock = clock;

    await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes[0]).toMatchObject({ outcome: "failed" });
    // review --failed--> done: the line completes rather than wedging.
    expect(await h.port.getById(id)).toMatchObject({ status: "finished" });
  });

  it("fails a row stuck queued for over 30 minutes", async () => {
    const h = harness();
    const old = new Date(Date.now() - 45 * MIN);
    const clock = h.port.clock;

    h.port.clock = () => old;
    const id = await h.port.start({
      definitionName: "code-review",
      repo: "o/r",
      args: {},
    });

    h.port.clock = clock;
    await assemblyLineReaperJob(h.deps);

    expect(await h.port.getById(id)).toMatchObject({
      status: "failed",
      outcome: "error",
    });
  });

  it("re-advances a running row with no open node (crash between transitions)", async () => {
    const h = harness();
    const id = await h.port.start({
      definitionName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);

    await assemblyLineReaperJob(h.deps);

    // advanceLine replays: no visits → launch the entry node.
    expect(h.launched).toHaveLength(1);
    expect(h.port.nodes[0]).toMatchObject({ nodeId: "review" });
  });

  it("leaves a single-CR row whose backing task is still running alone", async () => {
    const h = harness();
    const singleCr = await h.port.start({
      definitionName: "runbook",
      repo: "o/r",
      taskId: "task-1",
    });

    await h.port.markRunning(singleCr);
    h.taskStatusById["task-1"] = "running";
    await assemblyLineReaperJob(h.deps);

    expect(await h.port.getById(singleCr)).toMatchObject({ status: "running" });
  });

  it("sweeps a crash-orphaned single-CR row whose backing task went terminal", async () => {
    const h = harness();
    const singleCr = await h.port.start({
      definitionName: "runbook",
      repo: "o/r",
      taskId: "task-1",
    });

    await h.port.markRunning(singleCr);
    // The task finished but the watcher crashed before closing the run row.
    h.taskStatusById["task-1"] = "pr-created";
    await assemblyLineReaperJob(h.deps);

    expect(await h.port.getById(singleCr)).toMatchObject({
      status: "finished",
      outcome: "pr_created",
    });
    expect(h.launched).toEqual([]);
  });
});
