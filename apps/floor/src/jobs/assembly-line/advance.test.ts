import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import {
  advanceLine,
  finishLine,
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

const commentTriageLike: AssemblyLine = parseAssemblyLine(`
name: comment-triage
description: classify a PR comment
version: 1
entry: triage
exit: done
nodes:
  - id: triage
    type: comment-triage
  - id: done
    type: retrospective
edges:
  - from: triage
    to: done
    on: success
  - from: triage
    to: done
    on: failed
`);

function makeDeps(port: InMemoryAssemblyLines) {
  const launched: LoreTaskSpec[] = [];
  const cleaned: string[] = [];
  const jobRuns: string[] = [];
  const notified: Array<{ id: string; outcome: string; reason?: string }> = [];
  const deps: AdvanceDeps = {
    assemblyLines: port,
    definitions: async () =>
      new Map<string, AssemblyLine>([
        ["code-review", codeReviewLike],
        ["comment-triage", commentTriageLike],
      ]),
    launch: async (spec) => {
      launched.push(spec);
    },
    resolvePrompt: (promptRef, description) => `${promptRef}::${description}`,
    cleanupToken: async (runTaskId) => {
      cleaned.push(runTaskId);
    },
    jobRuns: {
      complete: async (runId, summary) => {
        jobRuns.push(`complete:${runId}:${summary}`);
      },
      fail: async (runId, reason) => {
        jobRuns.push(`fail:${runId}:${reason}`);
      },
    },
    notifyFailure: async (row, outcome, reason) => {
      notified.push({ id: row.id, outcome, reason });
    },
  };

  return { deps, launched, cleaned, jobRuns, notified };
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
      name: `${id.substring(0, 12)}-review`,
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

const reviewLoop: AssemblyLine = parseAssemblyLine(`
name: code-review
description: review loops back to itself on changes_requested (revisit)
version: 1
entry: review
exit: done
nodes:
  - id: review
    type: agent
    prompt_ref: code-review
  - id: done
    type: retrospective
edges:
  - from: review
    to: done
    on: always
  - from: review
    to: review
    on: changes_requested
    iteration_max: 3
`);

describe("advanceLine revisited-node iteration (fresh CR per iteration)", () => {
  it("launches iteration 2 of a revisited node under a distinct, suffixed CR name", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await port.start({
      definitionName: "code-review",
      repo: "o/r",
      branch: "b",
      args: { description: "d" },
    });

    await port.markRunning(id);
    const { deps, launched } = makeDeps(port);

    deps.definitions = async () =>
      new Map<string, AssemblyLine>([["code-review", reviewLoop]]);

    await advanceLine(id, deps); // launches review@1
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: { outcome: "changes_requested" },
      },
      deps,
    );

    // review@1 closed changes_requested → review@2 launched under a fresh name.
    expect(port.nodes.map((n) => [n.nodeId, n.iteration])).toEqual([
      ["review", 1],
      ["review", 2],
    ]);
    expect(launched.map((l) => l.name)).toEqual([
      `${id.substring(0, 12)}-review`,
      `${id.substring(0, 12)}-review-2`,
    ]);
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
      name: `${id.substring(0, 12)}-refine`,
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

describe("advanceLine overlap guard (detect lines, lease parity)", () => {
  // Monotonic clock so the older row has a strictly-smaller createdAt (the guard
  // defers to the oldest; a same-millisecond tie would be resolved by uuid, which
  // is nondeterministic in a unit test).
  function tickingPort() {
    let t = 1_000;

    return new InMemoryAssemblyLines(() => new Date((t += 1000)));
  }

  it("finishes a newer duplicate as lease_held, leaving the older in flight", async () => {
    const port = tickingPort();
    const { deps, launched, jobRuns } = makeDeps(port);
    const first = await port.start({
      definitionName: "code-review",
      repo: "o/r",
      branch: "detect/code-review/o-r",
    });

    await port.markRunning(first);
    await advanceLine(first, deps);

    const second = await port.start({
      definitionName: "code-review",
      repo: "o/r",
      branch: "detect/code-review/o-r",
      args: { job_run_id: "jr-2" },
    });

    await port.markRunning(second);
    launched.length = 0;
    await advanceLine(second, deps);

    expect(await port.getById(second)).toMatchObject({
      status: "finished",
      outcome: "lease_held",
    });
    expect(launched).toEqual([]);
    expect(jobRuns).toEqual([expect.stringContaining("complete:jr-2:skipped")]);
    // The older run is untouched.
    expect(await port.getById(first)).toMatchObject({ status: "running" });
  });

  it("lets the OLDER row proceed even when a newer overlapping row exists (deterministic winner)", async () => {
    const port = tickingPort();
    const { deps, launched } = makeDeps(port);
    const older = await port.start({
      definitionName: "code-review",
      repo: "o/r",
      branch: "detect/code-review/o-r",
    });
    const newer = await port.start({
      definitionName: "code-review",
      repo: "o/r",
      branch: "detect/code-review/o-r",
    });

    await port.markRunning(older);
    await port.markRunning(newer);
    // Advancing the OLDER row does not defer — it launches its entry node.
    await advanceLine(older, deps);

    expect(await port.getById(older)).toMatchObject({ status: "running" });
    expect(launched).toHaveLength(1);
    void newer;
  });

  it("does not defer a newer comment-triage line on the same PR branch (distinct comments are not duplicates)", async () => {
    const port = tickingPort();
    const { deps, launched } = makeDeps(port);
    const first = await port.start({
      definitionName: "comment-triage",
      repo: "o/r",
      branch: "feat/pr-branch",
      args: { comment_id: 1 },
    });

    await port.markRunning(first);
    await advanceLine(first, deps);

    const second = await port.start({
      definitionName: "comment-triage",
      repo: "o/r",
      branch: "feat/pr-branch",
      args: { comment_id: 2 },
    });

    await port.markRunning(second);
    await advanceLine(second, deps);

    // Both classify their own comment — neither is dropped as lease_held.
    expect(await port.getById(first)).toMatchObject({ status: "running" });
    expect(await port.getById(second)).toMatchObject({ status: "running" });
    expect(launched).toHaveLength(2);
  });
});

describe("advanceLine job_runs bookkeeping (detect lines)", () => {
  it("completes the args.job_run_id run when the line finishes", async () => {
    const port = new InMemoryAssemblyLines();
    const { deps, jobRuns } = makeDeps(port);
    const id = await port.start({
      definitionName: "code-review",
      repo: "o/r",
      branch: "b",
      args: { job_run_id: "jr-1" },
    });

    await port.markRunning(id);
    await advanceLine(id, deps);
    await port.finishNodeOnce(port.nodes[0]!.id, "success");
    await advanceLine(id, deps);

    expect(jobRuns).toEqual([expect.stringContaining("complete:jr-1:")]);
  });

  it("fails the args.job_run_id run when the line fails", async () => {
    const successOnly: AssemblyLine = parseAssemblyLine(`
name: detect-like
description: detect → done, every outcome routes to done
version: 1
entry: detect-node
exit: done
nodes:
  - id: detect-node
    type: detect
    job_ref: spec_drift
  - id: done
    type: retrospective
edges:
  - from: detect-node
    to: done
    on: always
`);
    const port = new InMemoryAssemblyLines();
    const { deps, jobRuns } = makeDeps(port);

    deps.definitions = async () =>
      new Map<string, AssemblyLine>([["detect-like", successOnly]]);
    const id = await port.start({
      definitionName: "detect-like",
      repo: "o/r",
      branch: "detect/detect-like/o-r",
      args: { job_run_id: "jr-1" },
    });

    await port.markRunning(id);
    await advanceLine(id, deps);
    await port.finishNodeOnce(port.nodes[0]!.id, "failed");
    await advanceLine(id, deps);

    expect(await port.getById(id)).toMatchObject({ outcome: "failed" });
    expect(jobRuns.at(-1)).toContain("fail:jr-1:");
  });

  it("closes the line with outcome failed when a node failed on the way to exit", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps, notified } = makeDeps(port);

    await advanceLine(id, deps);
    await port.finishNodeOnce(port.nodes[0]!.id, "failed");
    await advanceLine(id, deps);

    expect(await port.getById(id)).toMatchObject({ outcome: "failed" });
    expect(notified).toEqual([
      { id, outcome: "failed", reason: 'node "review" failed' },
    ]);
  });

  it("does not notify when the walk finishes completed", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps, notified } = makeDeps(port);

    await advanceLine(id, deps);
    await port.finishNodeOnce(port.nodes[0]!.id, "success");
    await advanceLine(id, deps);

    expect(await port.getById(id)).toMatchObject({ outcome: "completed" });
    expect(notified).toEqual([]);
  });

  it("does not notify the lease_held defer of an overlapping duplicate", async () => {
    const port = new InMemoryAssemblyLines();
    const first = await runningLine(port);
    const second = await runningLine(port);
    const { deps, notified } = makeDeps(port);

    await advanceLine(first, deps);
    await advanceLine(second, deps);

    const outcomes = [
      (await port.getById(first))?.outcome,
      (await port.getById(second))?.outcome,
    ];

    expect(outcomes.filter((o) => o === "lease_held")).toHaveLength(1);
    expect(notified).toEqual([]);
  });

  it("notifies exactly once when racing finishers close the same failed line", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps, notified } = makeDeps(port);
    const row = (await port.getById(id))!;

    await finishLine(row, "error", "station exploded", deps);
    await finishLine(row, "error", "late racer", deps);

    expect(notified).toEqual([
      { id, outcome: "error", reason: "station exploded" },
    ]);
  });

  it("finishes the line even when the failure notifier throws", async () => {
    const port = new InMemoryAssemblyLines();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);

    deps.notifyFailure = async () => {
      throw new Error("slack down");
    };
    const row = (await port.getById(id))!;

    await finishLine(row, "error", "station exploded", deps);

    expect(await port.getById(id)).toMatchObject({
      status: "failed",
      outcome: "error",
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

describe("advanceLine overlap guard — code-review-recheck opt-out", () => {
  const recheckDef: AssemblyLine = parseAssemblyLine(`
name: code-review-recheck
description: fast re-check
version: 1
entry: recheck
exit: done
nodes:
  - id: recheck
    type: agent
    prompt_ref: code-review-recheck
  - id: done
    type: retrospective
edges:
  - from: recheck
    to: done
    on: success
  - from: recheck
    to: done
    on: changes_requested
  - from: recheck
    to: done
    on: failed
`);

  it("does not defer a code-review-recheck line behind an older line on the same PR branch, so the verdict update is never silently dropped", async () => {
    const port = new InMemoryAssemblyLines();
    const launched: LoreTaskSpec[] = [];
    const deps: AdvanceDeps = {
      assemblyLines: port,
      definitions: async () =>
        new Map<string, AssemblyLine>([
          ["code-review", codeReviewLike],
          ["code-review-recheck", recheckDef],
        ]),
      launch: async (spec) => {
        launched.push(spec);
      },
      resolvePrompt: (promptRef, description) => `${promptRef}::${description}`,
      cleanupToken: async () => {},
      jobRuns: { complete: async () => {}, fail: async () => {} },
      notifyFailure: async () => {},
    };

    const older = await port.start({
      definitionName: "code-review",
      repo: "o/r",
      branch: "feat/pr-branch",
      args: { pr_number: 1 },
    });

    await port.markRunning(older);
    await advanceLine(older, deps);

    const recheck = await port.start({
      definitionName: "code-review-recheck",
      repo: "o/r",
      branch: "feat/pr-branch",
      args: { pr_number: 1 },
    });

    await port.markRunning(recheck);
    await advanceLine(recheck, deps);

    expect(await port.getById(recheck)).toMatchObject({ status: "running" });
    expect(launched).toHaveLength(2);
  });
});

// ── Fork-and-rerun (specs/fork-rerun-from-node FR5): the walk itself is
//    untouched — a forked line's inherited rows replay through nextTransition
//    like any other history. What the guard needs is to stop reading "has node
//    rows" as "already started work".
describe("advanceLine on a forked line", () => {
  const HASH = "hash-code-review";

  async function forkableLine(
    port: InMemoryAssemblyLines,
    branch = "feat/x",
  ): Promise<string> {
    const id = await port.start({
      definitionName: "code-review",
      repo: "re-cinq/lore",
      branch,
      args: { description: "Review pull request #7", pr_number: 7 },
    });

    await port.stampDefinitionHash(id, HASH);
    await port.markRunning(id);

    const { nodeRowId } = await port.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
    });

    await port.finishNodeOnce(nodeRowId, "changes_requested", "sha-review");
    await port.finish(id, "failed", 'node "refine" failed');

    return id;
  }

  async function fork(
    port: InMemoryAssemblyLines,
    source: string,
  ): Promise<string> {
    const id = await port.start({
      definitionName: "code-review",
      repo: "re-cinq/lore",
      definitionHash: HASH,
      resumeFrom: { lineId: source, nodeId: "review" },
    });

    await port.markRunning(id);

    return id;
  }

  it("launches the successor of the inherited node, not the entry node", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await forkableLine(port);
    const forked = await fork(port, source);
    const { deps, launched } = makeDeps(port);

    await advanceLine(forked, deps);

    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({
      name: `${forked.substring(0, 12)}-refine`,
      branch: "feat/x",
    });
    expect((await port.listNodes(forked)).map((n) => n.nodeId)).toEqual([
      "review",
      "refine",
    ]);
  });

  it("does not re-run the inherited node", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await forkableLine(port);
    const forked = await fork(port, source);
    const { deps, launched } = makeDeps(port);

    await advanceLine(forked, deps);

    expect(launched.map((spec) => spec.name)).not.toContain(
      `${forked.substring(0, 12)}-review`,
    );
  });

  it("defers as lease_held when another open line already holds the inherited branch", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await forkableLine(port);
    const holder = await port.start({
      definitionName: "code-review",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { pr_number: 7 },
    });

    await port.markRunning(holder);
    const forked = await fork(port, source);
    const { deps, launched } = makeDeps(port);

    await advanceLine(forked, deps);

    expect(await port.getById(forked)).toMatchObject({
      status: "finished",
      outcome: "lease_held",
    });
    expect(launched).toHaveLength(0);
  });

  it("proceeds when the only other line on the branch is the terminal source", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await forkableLine(port);
    const forked = await fork(port, source);
    const { deps, launched } = makeDeps(port);

    await advanceLine(forked, deps);

    expect(await port.getById(forked)).toMatchObject({ status: "running" });
    expect(launched).toHaveLength(1);
  });

  it("stops guarding once the fork has launched work of its own", async () => {
    const port = new InMemoryAssemblyLines();
    const source = await forkableLine(port);
    const forked = await fork(port, source);
    const { deps, launched } = makeDeps(port);

    await advanceLine(forked, deps);
    const holder = await port.start({
      definitionName: "code-review",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { pr_number: 7 },
    });

    await port.markRunning(holder);
    await advanceLine(forked, deps);

    expect(await port.getById(forked)).toMatchObject({ status: "running" });
    expect(launched).toHaveLength(1);
  });
});
