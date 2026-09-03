import { describe, it, expect } from "vitest";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import { snapshotGraph } from "@re-cinq/lore-assembly-lines";
import {
  advanceLine,
  collectPriorNodeFailures,
  finishLine,
  finishNodeAndAdvance,
  lineOutcomeFromVisits,
  taskFromAssemblyRun,
  type AdvanceDeps,
} from "./advance.js";
import { LlmDispatchGate } from "./llm-dispatch-gate.js";

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

const authorGated = parseAssemblyLine(`
name: author-gated
description: a line that waits on the author
version: 1
entry: author
exit: done
nodes:
  - id: author
    type: feature_review
    route: /repos/{args.repo}/features/{args.feature_id}
  - id: done
    type: retrospective
edges:
  - from: author
    to: done
    on: always
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

describe("advanceLine reads the run's own graph", () => {
  it("labels the enqueued dispatch spec with the station run id so a pod is traceable from Kubernetes alone (FR6.39)", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      branch: "feat/label",
      args: { description: "Review pull request #9", pr_number: 9 },
    });

    await port.stampBlueprint(
      id,
      "hash-code-review",
      snapshotGraph(codeReviewLike, "code-review"),
    );
    await port.markRunning(id);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, deps);

    const rows = await port.listStationRuns(id);

    expect(enqueued[0]?.extraLabels?.["lore.re-cinq.com/station-run-id"]).toBe(
      rows[0].stationRunId,
    );
  });

  it("walks the stamped clone, never re-reading the blueprint file", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "Review pull request #7", pr_number: 7 },
    });

    await port.stampBlueprint(
      id,
      "hash-code-review",
      snapshotGraph(codeReviewLike, "code-review"),
    );
    await port.markRunning(id);
    const { deps, enqueued } = makeDeps(port);

    deps.definitions = async () => {
      throw new Error("the walk must not read the blueprint file");
    };
    await advanceLine(id, deps);

    expect(enqueued.map((s) => s.name)).toEqual([
      `${id.substring(0, 12)}-review`,
    ]);
  });

  it("falls back to the blueprint by name for a run stamped before clones existed", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      branch: "feat/y",
      args: { description: "Review pull request #8", pr_number: 8 },
    });

    await port.markRunning(id);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, deps);

    expect((await port.getById(id))?.graph).toBeNull();
    expect(enqueued.map((s) => s.name)).toEqual([
      `${id.substring(0, 12)}-review`,
    ]);
  });
});

describe("advanceLine", () => {
  it("enqueues the entry node dispatch with the row's description in the prompt", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, deps);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      name: `${id.substring(0, 12)}-review`,
      taskType: "code-review",
      prompt: "code-review::Review pull request #7",
      branch: "feat/x",
    });
    expect(port.nodes).toEqual([
      expect.objectContaining({ nodeId: "review", iteration: 1 }),
    ]);
  });

  it("dispatches the resumed round's feedback as the CR's description, since the recipe renders {description} not spec.prompt", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: {
        description: "the whole draft",
        round_feedback: "<RoundFeedback/>",
      },
    });

    await port.markRunning(id);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, {
      ...deps,
      resolveConversation: async () => ({
        source: "http://floor/api/agent-conversations",
        id: "round-1",
        pin: "round-2",
        headersSecret: "agent-events-auth",
      }),
    });

    expect(enqueued[0]).toMatchObject({
      description: "<RoundFeedback/>",
      prompt: "code-review::<RoundFeedback/>",
    });
  });

  it("dispatches the full composition when nothing was resumed", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: {
        description: "the whole draft",
        round_feedback: "<RoundFeedback/>",
      },
    });

    await port.markRunning(id);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, {
      ...deps,
      resolveConversation: async () => ({
        source: "http://floor/api/agent-conversations",
        id: "",
        pin: "round-1",
        headersSecret: "agent-events-auth",
      }),
    });

    expect(enqueued[0]).toMatchObject({
      description: "the whole draft",
      prompt: "code-review::the whole draft",
    });
  });

  it("records a wait node but enqueues nothing — its worker is not a pod", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "author-gated",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "plan it" },
    });

    await port.markRunning(id);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, {
      ...deps,
      definitions: async () =>
        new Map<string, AssemblyLine>([["author-gated", authorGated]]),
    });

    expect(port.nodes).toEqual([
      expect.objectContaining({ nodeId: "author", iteration: 1 }),
    ]);
    expect(enqueued).toEqual([]);
  });

  it("converges a duplicate advance onto one node row and one armed dispatch via the CR name's ON CONFLICT, no 409", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, deps);
    await advanceLine(id, deps);

    expect(port.nodes).toHaveLength(1);
    expect(new Set(enqueued.map((l) => l.name)).size).toBe(1);
  });

  it("does nothing while the newest node row is still open", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, deps);
    enqueued.length = 0;
    await advanceLine(id, deps);

    expect(enqueued).toEqual([]);
  });

  it("finishes the row completed and reclaims the token when the walk reaches exit", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, cleaned } = makeDeps(port);

    await advanceLine(id, deps);
    const nodeRowId = port.nodes[0]!.id;

    await port.finishStationRunOnce(nodeRowId, "success");
    await advanceLine(id, deps);

    expect(await port.getById(id)).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
    expect(cleaned).toEqual([id]);
  });

  it("skips rows that are not running and unknown definitions", async () => {
    const port = new InMemoryAssemblyRuns();
    const queued = await port.start({
      blueprintName: "code-review",
      repo: "o/r",
    });
    const singleCr = await port.start({
      blueprintName: "runbook",
      repo: "o/r",
      taskId: "task-1",
    });

    await port.markRunning(singleCr);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(queued, deps);
    await advanceLine(singleCr, deps);

    expect(enqueued).toEqual([]);
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
  it("enqueues iteration 2 of a revisited node under a distinct, suffixed CR name", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "code-review",
      repo: "o/r",
      branch: "b",
      args: { description: "d" },
    });

    await port.markRunning(id);
    const { deps, enqueued } = makeDeps(port);

    deps.definitions = async () =>
      new Map<string, AssemblyLine>([["code-review", reviewLoop]]);

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: { outcome: "changes_requested" },
      },
      deps,
    );

    expect(port.nodes.map((n) => [n.nodeId, n.iteration])).toEqual([
      ["review", 1],
      ["review", 2],
    ]);
    expect(enqueued.map((l) => l.name)).toEqual([
      `${id.substring(0, 12)}-review`,
      `${id.substring(0, 12)}-review-2`,
    ]);
  });
});

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

describe("advanceLine job_runs bookkeeping (detect lines)", () => {
  it("completes the args.job_run_id run when the line finishes", async () => {
    const port = new InMemoryAssemblyRuns();
    const { deps, jobRuns } = makeDeps(port);
    const id = await port.start({
      blueprintName: "code-review",
      repo: "o/r",
      branch: "b",
      args: { job_run_id: "jr-1" },
    });

    await port.markRunning(id);
    await advanceLine(id, deps);
    await port.finishStationRunOnce(port.nodes[0]!.id, "success");
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
    const port = new InMemoryAssemblyRuns();
    const { deps, jobRuns } = makeDeps(port);

    deps.definitions = async () =>
      new Map<string, AssemblyLine>([["detect-like", successOnly]]);
    const id = await port.start({
      blueprintName: "detect-like",
      repo: "o/r",
      branch: "detect/detect-like/o-r",
      args: { job_run_id: "jr-1" },
    });

    await port.markRunning(id);
    await advanceLine(id, deps);
    await port.finishStationRunOnce(port.nodes[0]!.id, "failed");
    await advanceLine(id, deps);

    expect(await port.getById(id)).toMatchObject({ outcome: "failed" });
    expect(jobRuns.at(-1)).toContain("fail:jr-1:");
  });

  it("closes the line with outcome failed when a node failed on the way to exit", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, notified } = makeDeps(port);

    await advanceLine(id, deps);
    await port.finishStationRunOnce(port.nodes[0]!.id, "failed");
    await advanceLine(id, deps);

    expect(await port.getById(id)).toMatchObject({ outcome: "failed" });
    expect(notified).toEqual([
      { id, outcome: "failed", reason: 'node "review" failed' },
    ]);
  });

  it("parks an agent node instead of enqueueing it while the account is dry, minting no station-run row the reaper would relaunch", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, enqueued } = makeDeps(port);
    const gate = new LlmDispatchGate(() => new Date());

    gate.trip("anthropic-credit", "Credit balance is too low");
    await advanceLine(id, { ...deps, llmGate: gate });

    expect(enqueued).toEqual([]);
    expect(port.nodes).toEqual([]);
    expect(await port.getById(id)).toMatchObject({ status: "running" });
  });

  it("names the run and node it parked, so an outage is not silent", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);
    const gate = new LlmDispatchGate(() => new Date());
    const logged: string[] = [];
    const realLog = console.log;

    console.log = (message: string) => logged.push(message);
    gate.trip("anthropic-credit", "Credit balance is too low");

    try {
      await advanceLine(id, { ...deps, llmGate: gate });
    } finally {
      console.log = realLog;
    }

    expect(logged.join("\n")).toContain(`parked ${id} at node "review"`);
  });

  it("enqueues the node it parked once the account is healthy again", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, enqueued } = makeDeps(port);
    const gate = new LlmDispatchGate(() => new Date());

    gate.trip("anthropic-credit", "Credit balance is too low");
    await advanceLine(id, { ...deps, llmGate: gate });
    gate.clear();
    await advanceLine(id, { ...deps, llmGate: gate });

    expect(enqueued).toHaveLength(1);
    expect(port.nodes).toHaveLength(1);
  });

  it("records the classified failure on the station run it just finished", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: {
          outcome: "failed",
          failureClass: "anthropic-credit",
          failureDetail: "Credit balance is too low",
        },
      },
      deps,
    );

    expect(port.nodes[0]).toMatchObject({
      outcome: "failed",
      failureClass: "anthropic-credit",
      failureDetail: "Credit balance is too low",
    });
  });

  it("closes the line with the cause the node recorded, not the node id alone", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, notified } = makeDeps(port);

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "review",
        iteration: 1,
        result: {
          outcome: "failed",
          failureClass: "anthropic-credit",
          failureDetail: "Credit balance is too low",
        },
      },
      deps,
    );

    expect(notified).toEqual([
      {
        id,
        outcome: "failed",
        reason:
          'node "review" failed: Credit balance is too low — Top up the ' +
          "Anthropic account behind the agent's ANTHROPIC_API_KEY (Plans & Billing).",
      },
    ]);
  });

  it("does not notify when the walk finishes completed", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, notified } = makeDeps(port);

    await advanceLine(id, deps);
    await port.finishStationRunOnce(port.nodes[0]!.id, "success");
    await advanceLine(id, deps);

    expect(await port.getById(id)).toMatchObject({ outcome: "completed" });
    expect(notified).toEqual([]);
  });

  it("notifies exactly once when racing finishers close the same failed line", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, notified } = makeDeps(port);
    const row = (await port.getById(id))!;

    await finishLine(row, "error", "station exploded", deps);
    await finishLine(row, "error", "late racer", deps);

    expect(notified).toEqual([
      { id, outcome: "error", reason: "station exploded" },
    ]);
  });

  it("settles the backing task once for the winning finisher only", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);
    const settled: { outcome: string; reason?: string }[] = [];

    deps.settleTask = async (_row, outcome, reason) => {
      settled.push({ outcome, reason });
    };
    const row = (await port.getById(id))!;

    await finishLine(row, "error", "station exploded", deps);
    await finishLine(row, "error", "late racer", deps);

    expect(settled).toEqual([{ outcome: "error", reason: "station exploded" }]);
  });

  it("finishes the line even when the failure notifier throws", async () => {
    const port = new InMemoryAssemblyRuns();
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

describe("taskFromAssemblyRun", () => {
  it("derives the synthetic taskId for a task-less row and keeps the real one otherwise", async () => {
    const port = new InMemoryAssemblyRuns();
    const taskless = await port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: { description: "d" },
    });
    const rowless = (await port.getById(taskless))!;

    expect(taskFromAssemblyRun(rowless)).toMatchObject({
      taskId: taskless,
      pipelineTaskId: null,
      assemblyLineId: taskless,
      description: "d",
    });

    const taskful = await port.start({
      blueprintName: "implementation",
      repo: "o/r",
      taskId: "task-9",
    });

    expect(taskFromAssemblyRun((await port.getById(taskful))!)).toMatchObject({
      taskId: "task-9",
      pipelineTaskId: "task-9",
    });
  });
});

describe("advanceLine on a forked line (specs/fork-rerun-from-node FR5)", () => {
  const HASH = "hash-code-review";

  function orderedPort(): InMemoryAssemblyRuns {
    let tick = 0;

    return new InMemoryAssemblyRuns(
      () => new Date(Date.UTC(2026, 7, 7) + ++tick * 1000),
    );
  }

  async function forkableLine(
    port: InMemoryAssemblyRuns,
    branch = "feat/x",
  ): Promise<string> {
    const id = await port.start({
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      branch,
      args: { description: "Review pull request #7", pr_number: 7 },
    });

    await port.stampBlueprint(id, HASH);
    await port.markRunning(id);

    const { nodeRowId } = await port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
    });

    await port.finishStationRunOnce(
      nodeRowId,
      "changes_requested",
      "sha-review",
    );
    await port.finish(id, "failed", 'node "refine" failed');

    return id;
  }

  async function fork(
    port: InMemoryAssemblyRuns,
    source: string,
  ): Promise<string> {
    const id = await port.start({
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      blueprintHash: HASH,
      resumeFrom: { lineId: source, nodeId: "review" },
    });

    await port.markRunning(id);

    return id;
  }

  it("enqueues the successor of the inherited node, not the entry node", async () => {
    const port = orderedPort();
    const source = await forkableLine(port);
    const forked = await fork(port, source);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(forked, deps);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      name: `${forked.substring(0, 12)}-refine`,
      branch: "feat/x",
    });
    expect((await port.listStationRuns(forked)).map((n) => n.nodeId)).toEqual([
      "review",
      "refine",
    ]);
  });

  it("does not re-run the inherited node", async () => {
    const port = orderedPort();
    const source = await forkableLine(port);
    const forked = await fork(port, source);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(forked, deps);

    expect(enqueued.map((spec) => spec.name)).not.toContain(
      `${forked.substring(0, 12)}-review`,
    );
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

describe("the visit's row records what it was dispatched with", () => {
  it("dispatching a node persists its input on the station-run row it mints, since the pruned CR is otherwise the only record", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);

    await advanceLine(id, deps);

    expect((await port.listStationRuns(id))[0].input).toMatchObject({
      description: "Review pull request #7",
      prompt: "code-review::Review pull request #7",
      params: null,
      repo: "re-cinq/lore",
    });
  });

  it("a human station's row records its input even though nothing is dispatched", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "author-gated",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "plan it" },
    });

    await port.markRunning(id);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, {
      ...deps,
      definitions: async () =>
        new Map<string, AssemblyLine>([["author-gated", authorGated]]),
    });

    expect(enqueued).toEqual([]);
    expect((await port.listStationRuns(id))[0].input).toMatchObject({
      description: "plan it",
      prompt: null,
      repo: "re-cinq/lore",
      ref: "feat/x",
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

describe("a node whose station runs in the pooled service is not given a pod", () => {
  it("publishes the node for the service to claim instead of enqueueing a pod dispatch", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "triage-then-issues",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "d" },
    });

    await port.markRunning(id);

    const { deps, enqueued } = makeDeps(port);
    const published: Array<{
      eventName: string;
      params: Record<string, unknown>;
    }> = [];

    deps.publishNode = async (ev) => {
      published.push(ev);
    };

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "triage",
        iteration: 1,
        result: { outcome: "success" },
      },
      deps,
    );

    expect(published.map((e) => e.eventName)).toEqual([
      "station.run",
      "station.run",
    ]);
    expect(enqueued).toEqual([]);
  });

  it("publishes an open node once, keyed to the visit not the node, so a redelivered event re-drives without duplicating", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "triage-then-issues",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "d" },
    });

    await port.markRunning(id);

    const { deps } = makeDeps(port);
    const published: Array<{ dedupeKey?: string }> = [];

    deps.publishNode = async (ev) => {
      published.push(ev);
    };

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "triage",
        iteration: 1,
        result: { outcome: "success" },
      },
      deps,
    );
    await advanceLine(id, deps);

    expect(published).toHaveLength(2);

    for (const ev of published) {
      expect(ev.dedupeKey).toMatch(/^station-run:.+/);
    }
  });

  it("still enqueues a pod station's dispatch, so isolation is not quietly withdrawn", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, enqueued } = makeDeps(port);
    const published: unknown[] = [];

    deps.publishNode = async (ev) => {
      published.push(ev);
    };

    await advanceLine(id, deps);

    expect(published).toEqual([]);
    expect(enqueued).toHaveLength(1);
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

describe("a service-form node's visit names no CR", () => {
  it("writes a null agent_cr_name, which is what stops the reaper relaunching it as a pod", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "triage-then-issues",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "d" },
    });

    await port.markRunning(id);

    const { deps } = makeDeps(port);

    deps.publishNode = async () => {};

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "triage",
        iteration: 1,
        result: { outcome: "success" },
      },
      deps,
    );

    expect(port.nodes.find((n) => n.nodeId === "file")?.agentCrName).toBeNull();
  });

  it("still names the CR for a pod node, which the reaper resolves by that name", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);

    await advanceLine(id, deps);

    expect(port.nodes.find((n) => n.nodeId === "review")?.agentCrName).toBe(
      `${id.substring(0, 12)}-review`,
    );
  });
});

describe("pull-based dispatch writes claimable queued rows (FR3)", () => {
  const taggedReview: AssemblyLine = parseAssemblyLine(`
name: code-review
description: a pod node that requires a capability tag
version: 1
entry: review
exit: done
nodes:
  - id: review
    type: agent
    prompt_ref: code-review
    required_tags: [gpu]
  - id: done
    type: retrospective
edges:
  - from: review
    to: done
    on: always
`);

  it("parks a pod node's row queued, unclaimed, armed with the exact dispatch spec a claiming cluster-agent is handed", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, enqueued } = makeDeps(port);

    await advanceLine(id, deps);

    expect(port.nodes[0]).toMatchObject({
      nodeId: "review",
      status: "queued",
      clusterAgentId: null,
      claimedAt: null,
      requiredTags: ["node:agent"],
    });
    const claim = await port.claimNextStationRun({
      clusterAgentId: "central",
      tags: ["node:agent"],
    });

    expect(claim).toMatchObject({
      stationRunId: port.nodes[0].stationRunId,
      dispatchSpec: enqueued[0],
    });
  });

  it("stamps the node's own required_tags [gpu] onto the queued row", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);

    await port.stampBlueprint(
      id,
      "hash-tagged",
      snapshotGraph(taggedReview, "code-review"),
    );
    const { deps } = makeDeps(port);

    await advanceLine(id, deps);

    expect(port.nodes[0]).toMatchObject({
      requiredTags: ["node:agent", "gpu"],
    });
    expect(
      await port.claimNextStationRun({ clusterAgentId: "plain", tags: [] }),
    ).toBeNull();
    expect(
      await port.claimNextStationRun({
        clusterAgentId: "gpu-1",
        tags: ["node:agent", "gpu"],
      }),
    ).toMatchObject({ nodeId: "review" });
  });

  it("inherits the repo's station_default_tags [linux] when the node names none", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps } = makeDeps(port);

    deps.repoSettings = async () => ({ station_default_tags: ["linux"] });
    await advanceLine(id, deps);

    expect(port.nodes[0]).toMatchObject({
      requiredTags: ["node:agent", "linux"],
    });
  });

  it("keeps a human station's row running, so it is never claimable", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "author-gated",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "plan it" },
    });

    await port.markRunning(id);
    const { deps } = makeDeps(port);

    await advanceLine(id, {
      ...deps,
      definitions: async () =>
        new Map<string, AssemblyLine>([["author-gated", authorGated]]),
    });

    expect(port.nodes[0]).toMatchObject({
      nodeId: "author",
      status: "running",
    });
    expect(
      await port.claimNextStationRun({ clusterAgentId: "central", tags: [] }),
    ).toBeNull();
  });

  it("keeps a service node's row running, so it is never claimable", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "triage-then-issues",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "d" },
    });

    await port.markRunning(id);
    const { deps } = makeDeps(port);

    deps.publishNode = async () => {};

    await advanceLine(id, deps);
    await finishNodeAndAdvance(
      {
        assemblyLineId: id,
        nodeId: "triage",
        iteration: 1,
        result: { outcome: "success" },
      },
      deps,
    );

    expect(port.nodes.find((n) => n.nodeId === "file")).toMatchObject({
      status: "running",
    });
    expect(
      await port.claimNextStationRun({ clusterAgentId: "central", tags: [] }),
    ).toBeNull();
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

describe("lineOutcomeFromVisits", () => {
  it("blames the terminal fix-ci failure, not the recovered ready-for-review retry (regression seen in run 52c3fdd5)", () => {
    const outcome = lineOutcomeFromVisits([
      { nodeId: "tdd-round", iteration: 1, outcome: "success" },
      {
        nodeId: "ready-for-review",
        iteration: 1,
        outcome: "failed",
        failureDetail: "BackoffLimitExceeded",
      },
      { nodeId: "ready-for-review", iteration: 2, outcome: "success" },
      { nodeId: "await-pr", iteration: 2, outcome: "changes_requested" },
      {
        nodeId: "fix-ci",
        iteration: 1,
        outcome: "failed",
        failureDetail: "pod died",
      },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    expect(outcome).toEqual({
      outcome: "failed",
      reason: 'node "fix-ci" failed: pod died',
    });
  });

  it("closes completed when the only failure was recovered by the node's later success", () => {
    const outcome = lineOutcomeFromVisits([
      { nodeId: "review", iteration: 1, outcome: "failed" },
      { nodeId: "review", iteration: 2, outcome: "success" },
      { nodeId: "done", iteration: 1, outcome: "success" },
    ]);

    expect(outcome).toEqual({ outcome: "completed" });
  });

  it("still fails on an unrecovered failure that routed to the retrospective", () => {
    const outcome = lineOutcomeFromVisits([
      { nodeId: "review", iteration: 1, outcome: "failed" },
      { nodeId: "retrospective", iteration: 1, outcome: "success" },
    ]);

    expect(outcome).toEqual({
      outcome: "failed",
      reason: 'node "review" failed',
    });
  });
});
