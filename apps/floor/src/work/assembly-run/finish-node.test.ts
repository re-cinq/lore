import { describe, it, expect } from "vitest";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import { snapshotGraph } from "@re-cinq/lore-assembly-lines";
import { advanceLine } from "./advance-line.js";
import { collectPriorNodeFailures } from "./walk-state.js";
import { finishLine } from "./finish-line.js";
import { finishNodeAndAdvance } from "./finish-node.js";
import type { AdvanceDeps } from "./advance-deps.js";

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

const implementThenValidate: AssemblyLine = parseAssemblyLine(`
name: implementation-loop
description: implement -> validate -> done
version: 1
entry: implement
exit: done
nodes:
  - id: implement
    type: agent
    prompt_ref: implementation-tdd
  - id: validate
    type: validate
  - id: done
    type: retrospective
edges:
  - from: implement
    to: validate
    on: success
  - from: implement
    to: done
    on: failed
  - from: implement
    to: done
    on: changes_requested
  - from: validate
    to: done
    on: success
  - from: validate
    to: implement
    on: failed
    iteration_max: 2
`);

const triageThenIssues: AssemblyLine = parseAssemblyLine(`
name: triage-then-issues
description: a pod station, then one the pooled service runs
version: 1
entry: triage
exit: done
nodes:
  - id: triage
    type: comment-triage
  - id: file
    type: issues
  - id: done
    type: retrospective
edges:
  - from: triage
    to: file
    on: success
  - from: triage
    to: done
    on: failed
  - from: file
    to: done
    on: success
  - from: file
    to: done
    on: changes_requested
  - from: file
    to: done
    on: failed
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

const pushThenWait = parseAssemblyLine(`
name: push-then-wait
description: push, then wait for the PR to merge
version: 1
entry: push
exit: done
nodes:
  - id: push
    type: agent
    prompt_ref: push-only
  - id: merged
    type: pr_review
    route: "{args.pr_url}"
  - id: done
    type: retrospective
edges:
  - from: push
    to: merged
    on: always
  - from: merged
    to: done
    on: success
  - from: merged
    to: done
    on: changes_requested
  - from: merged
    to: done
    on: failed
`);

function makeDeps(port: InMemoryAssemblyRuns) {
  const enqueued: LoreTaskSpec[] = [];
  const cleaned: string[] = [];
  const jobRuns: string[] = [];
  const notified: Array<{ id: string; outcome: string; reason?: string }> = [];
  const armDispatch = port.enqueueStationRunDispatch.bind(port);

  port.enqueueStationRunDispatch = async (nodeRowId, dispatchSpec) => {
    enqueued.push(dispatchSpec as LoreTaskSpec);
    await armDispatch(nodeRowId, dispatchSpec);
  };
  const deps: AdvanceDeps = {
    assemblyRuns: port,
    definitions: async () =>
      new Map<string, AssemblyLine>([
        ["code-review", codeReviewLike],
        ["comment-triage", commentTriageLike],
        ["triage-then-issues", triageThenIssues],
        ["push-then-wait", pushThenWait],
      ]),
    repoSettings: async () => null,
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

  return { deps, enqueued, cleaned, jobRuns, notified };
}

async function runningLine(port: InMemoryAssemblyRuns) {
  const id = await port.start({
    blueprintName: "code-review",
    repo: "re-cinq/lore",
    branch: "feat/x",
    args: { description: "Review pull request #7", pr_number: 7 },
  });

  await port.markRunning(id);

  return id;
}

describe("finishNodeAndAdvance", () => {
  it("records the outcome and enqueues the next node per the definition", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, enqueued } = makeDeps(port);

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
    expect(enqueued.at(-1)).toMatchObject({
      name: `${id.substring(0, 12)}-refine`,
    });
  });

  it("hands the next node the failure that routed to it, not a byte-identical repeated prompt", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);

    await port.stampBlueprint(
      id,
      "hash-loop",
      snapshotGraph(implementThenValidate, "implementation-loop"),
    );
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "implement",
        result: { outcome: "success" },
      },
      deps,
    );
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "validate",
        result: {
          outcome: "failed",
          failureDetail: "validation failed: lint\n\n$ lint\nfoo.ts:1 error",
        },
      },
      deps,
    );

    const prompt = enqueued.at(-1)?.prompt ?? "";

    expect(prompt).toContain("The `validate` step failed on your last attempt");
    expect(prompt).toContain("foo.ts:1 error");
    expect(enqueued[0]?.prompt ?? "").not.toContain("previous step failed");
  });

  it("a forked run's first launch carries the source run's failure detail, since the fork's own copied rows have it nulled", async () => {
    const port = new InMemoryAssemblyRuns();
    const source = await port.start({
      blueprintName: "implementation-loop",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "implement the thing" },
    });

    await port.stampBlueprint(
      source,
      "hash-loop",
      snapshotGraph(implementThenValidate, "implementation-loop"),
    );
    await port.markRunning(source);

    for (const v of [
      { nodeId: "implement", iteration: 1, outcome: "success" },
      {
        nodeId: "validate",
        iteration: 1,
        outcome: "failed",
        failureDetail: "lint: unused var `skim`",
      },
      {
        nodeId: "implement",
        iteration: 2,
        outcome: "failed",
        failureDetail: "agent crashed: OOM while bending girders",
      },
    ]) {
      const { nodeRowId } = await port.ensureStationRun({
        assemblyRunId: source,
        nodeId: v.nodeId,
        iteration: v.iteration,
        agentCrName: `${source.slice(0, 12)}-${v.nodeId}`,
      });

      await port.finishStationRunOnce(nodeRowId, v.outcome, undefined, {
        failureDetail: v.failureDetail,
      });
    }
    await port.finish(source, "error", "node failed");

    const fork = await port.start({
      blueprintName: "implementation-loop",
      repo: "re-cinq/lore",
      blueprintHash: "hash-loop",
      resumeFrom: { lineId: source, nodeId: "validate", iteration: 1 },
    });

    await port.markRunning(fork);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(fork, deps);

    expect(enqueued.at(-1)).toMatchObject({
      name: `${fork.substring(0, 12)}-implement-2`,
    });
    const prompt = enqueued.at(-1)?.prompt ?? "";

    expect(prompt).toContain("Earlier attempts of this step failed");
    expect(prompt).toContain("agent crashed: OOM while bending girders");
  });

  it("collectPriorNodeFailures follows a fork-of-fork chain oldest first and stops at the hop bound", async () => {
    const runs = new Map<
      string,
      { resumedFromRunId: string | null; detail: string }
    >();

    for (let i = 1; i <= 7; i++) {
      runs.set(`run-${i}`, {
        resumedFromRunId: i === 7 ? null : `run-${i + 1}`,
        detail: `ancestor-${i} broke`,
      });
    }
    const deps = {
      assemblyRuns: {
        getById: async (id: string) => {
          const run = runs.get(id);

          return run
            ? ({ resumedFromRunId: run.resumedFromRunId } as never)
            : null;
        },
        listStationRuns: async (id: string) =>
          [
            {
              nodeId: "implement",
              iteration: 1,
              outcome: "failed",
              failureDetail: runs.get(id)?.detail,
            },
          ] as never,
      },
    } as unknown as Pick<AdvanceDeps, "assemblyRuns">;

    const failures = await collectPriorNodeFailures(
      { resumedFromRunId: "run-1" } as never,
      "implement",
      [
        {
          nodeId: "implement",
          iteration: 1,
          outcome: "failed",
          failureDetail: "own attempt broke",
        },
      ],
      deps,
    );

    expect(failures.map((f) => f.detail)).toEqual([
      "ancestor-5 broke",
      "ancestor-4 broke",
      "ancestor-3 broke",
      "ancestor-2 broke",
      "ancestor-1 broke",
      "own attempt broke",
    ]);
  });

  it("a plain run reads no source runs while dispatching", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, enqueued } = makeDeps(port);
    const reads: string[] = [];
    const getById = port.getById.bind(port);

    port.getById = async (runId) => {
      reads.push(runId);

      return getById(runId);
    };

    await advanceLine(id, deps);

    expect(enqueued).toHaveLength(1);
    expect(reads).toEqual([id]);
  });

  it("keeps the stored outcome when a duplicate event races the first writer", async () => {
    const port = new InMemoryAssemblyRuns();
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

describe("a push node that delivered nothing", () => {
  async function pushLine(port: InMemoryAssemblyRuns) {
    const id = await port.start({
      blueprintName: "push-then-wait",
      repo: "re-cinq/lore",
      branch: "lore/feature-planning/topic-b81f9fd2",
      args: { description: "Ship the spec", feature_id: "feat-1" },
    });

    await port.stampBlueprint(
      id,
      "hash-push-then-wait",
      snapshotGraph(pushThenWait, "push-then-wait"),
    );
    await port.markRunning(id);
    await port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "push",
      iteration: 1,
    });

    return id;
  }

  it("fails the line instead of parking it on a PR that cannot exist, since GitHub's empty branch outranks the pod's success", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await pushLine(port);
    const { deps, notified } = makeDeps(port);

    await finishNodeAndAdvance(
      { assemblyLineId: id, nodeId: "push", result: { outcome: "success" } },
      {
        ...deps,
        stampPr: async () => {
          throw new Error(
            'Validation Failed: {"message":"No commits between main and lore/feature-planning/topic-b81f9fd2"}',
          );
        },
      },
    );

    expect(await port.getById(id)).toMatchObject({
      status: "failed",
      reason:
        "the push node reported success but pushed nothing — lore/feature-planning/topic-b81f9fd2 has no commits, so no spec PR could be opened",
    });
    expect(notified).toHaveLength(1);
  });

  it("never reaches the wait node, so nothing waits for the missing PR", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await pushLine(port);
    const { deps } = makeDeps(port);

    await finishNodeAndAdvance(
      { assemblyLineId: id, nodeId: "push", result: { outcome: "success" } },
      {
        ...deps,
        stampPr: async () => {
          throw new Error("No commits between main and topic");
        },
      },
    );

    expect((await port.listStationRuns(id)).map((n) => n.nodeId)).toEqual([
      "push",
    ]);
  });

  it("keeps walking when the stamp failed for a transient reason, since a 502 says nothing about the branch", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await pushLine(port);
    const { deps } = makeDeps(port);

    await finishNodeAndAdvance(
      { assemblyLineId: id, nodeId: "push", result: { outcome: "success" } },
      {
        ...deps,
        stampPr: async () => {
          throw new Error("502 Bad Gateway");
        },
      },
    );

    expect(await port.getById(id)).toMatchObject({ status: "running" });
    expect((await port.listStationRuns(id)).map((n) => n.nodeId)).toEqual([
      "push",
      "merged",
    ]);
  });
});

describe("the ready flip hands the node's result to the markPrReady seam", () => {
  it("passes the finishing node's extras through, so the flip can read the Lore-Issue-Coverage verdict deciding Closes-vs-Refs (#1745)", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "push-then-wait",
      repo: "re-cinq/lore",
      branch: "lore/implementation-loop/issue-7",
      args: { description: "Fix the links", pr_number: 11 },
    });

    await port.stampBlueprint(
      id,
      "hash-push-then-wait",
      snapshotGraph(pushThenWait, "push-then-wait"),
    );
    await port.markRunning(id);
    await port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "push",
      iteration: 1,
    });
    const { deps } = makeDeps(port);
    const flipped: Array<{ runId: string; extras?: Record<string, string> }> =
      [];

    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "push",
        result: {
          outcome: "success",
          extras: { "Lore-Issue-Coverage": "partial" },
        },
      },
      {
        ...deps,
        markPrReady: async (run, result) => {
          flipped.push({ runId: run.id, extras: result.extras });
        },
      },
    );

    expect(flipped).toEqual([
      { runId: id, extras: { "Lore-Issue-Coverage": "partial" } },
    ]);
    expect((await port.getById(id))?.args).toMatchObject({
      pr_ready_flipped: true,
    });
  });
});

describe("a node finishing reaches its follow-up from every door", () => {
  it("hands the finished node's result to the reaction hook", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);
    const seen: Array<{ nodeId: string; result: NodeResult }> = [];

    deps.onNodeFinished = async (_row, node, result) => {
      seen.push({ nodeId: node.id, result });
    };

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: { outcome: "success", extras: { action: "address" } },
      },
      deps,
    );

    expect(seen).toEqual([
      {
        nodeId: "review",
        result: { outcome: "success", extras: { action: "address" } },
      },
    ]);
  });

  it("does not react twice when a redelivered event finds the node already closed", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);
    const seen: string[] = [];

    deps.onNodeFinished = async (_row, node) => {
      seen.push(node.id);
    };

    await advanceLine(id, deps);

    const finish = {
      assemblyLineId: id,
      nodeId: "review",
      iteration: 1,
      result: { outcome: "success" as const, extras: { action: "address" } },
    };

    await finishNodeAndAdvance(finish, deps);
    await finishNodeAndAdvance(finish, deps);

    expect(seen).toEqual(["review"]);
  });

  it("advances the walk even when the reaction throws, so routing cannot wedge a run", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);

    deps.onNodeFinished = async () => {
      throw new Error("routing is down");
    };

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: { outcome: "success" },
      },
      deps,
    );

    expect(port.nodes.find((n) => n.nodeId === "review")?.outcome).toBe(
      "success",
    );
  });
});

describe("a finished run records what happened", () => {
  it("writes the run's episode when the line reaches its exit", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);
    const episodes: Array<{ runId: string; outcome: string }> = [];

    deps.recordRunEpisode = async (run, outcome) => {
      episodes.push({ runId: run.id, outcome });
    };

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: { outcome: "success" },
      },
      deps,
    );

    expect(episodes).toEqual([{ runId: id, outcome: "completed" }]);
  });

  it("records a failed run too, which is the one worth reading later", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);
    const episodes: Array<{ outcome: string }> = [];

    deps.recordRunEpisode = async (_run, outcome) => {
      episodes.push({ outcome });
    };

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: { outcome: "failed" },
      },
      deps,
    );

    expect(episodes.map((e) => e.outcome)).toEqual(["failed"]);
  });

  it("closes the run even when recording the episode throws, since telemetry is not the work", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);

    deps.recordRunEpisode = async () => {
      throw new Error("memory is down");
    };

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: { outcome: "success" },
      },
      deps,
    );

    expect((await port.getById(id))?.status).toBe("finished");
  });
});

describe("a losing finisher's once-only side effects", () => {
  it("records one episode when the node event and the reaper both close the line, since the episode used to run before the first-writer-wins CAS", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);
    const episodes: Array<{ outcome: string; reason?: string }> = [];

    deps.recordRunEpisode = async (_row, outcome, reason) => {
      episodes.push({ outcome, reason });
    };
    const row = (await port.getById(id))!;

    await finishLine(row, "completed", undefined, deps);
    await finishLine(row, "error", "late racer", deps);

    expect(episodes).toEqual([{ outcome: "completed", reason: undefined }]);
  });
});

describe("what the node-finished reaction is told about the node", () => {
  it("hands over the node's type, so a reaction need not match its id or definition name by string (routeCommentTriage regression)", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);
    const seen: Array<{ id: string; type: string }> = [];

    deps.onNodeFinished = async (_row, node) => {
      seen.push({ id: node.id, type: node.type });
    };

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: { outcome: "success" },
      },
      deps,
    );

    expect(seen).toEqual([{ id: "review", type: "agent" }]);
  });
});
