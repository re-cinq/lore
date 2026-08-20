import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import { snapshotGraph } from "@re-cinq/lore-assembly-lines";
import {
  advanceLine,
  finishLine,
  finishNodeAndAdvance,
  taskFromRow,
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

/** push → merged(wait), the delivery shape: the pushing node is followed by a
 *  human station, so a push that delivered nothing parks the walk on a PR that
 *  cannot exist unless the stamp failure fails the line (#1330). */
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

/** A line whose entry node is parked on the author — the shape stage 1 introduces. */
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
  const launched: LoreTaskSpec[] = [];
  const cleaned: string[] = [];
  const jobRuns: string[] = [];
  const notified: Array<{ id: string; outcome: string; reason?: string }> = [];
  const deps: AdvanceDeps = {
    assemblyRuns: port,
    definitions: async () =>
      new Map<string, AssemblyLine>([
        ["code-review", codeReviewLike],
        ["comment-triage", commentTriageLike],
        ["push-then-wait", pushThenWait],
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
  it("labels the dispatched CR with the station run id", async () => {
    // The id is what telemetry keys on (FR6.39). Putting it on the CR is what
    // makes a running pod traceable back to its visit from Kubernetes alone,
    // rather than by re-deriving the visit from the CR's NAME.
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
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, deps);

    const rows = await port.listStationRuns(id);

    expect(launched[0]?.extraLabels?.["lore.re-cinq.com/station-run-id"]).toBe(
      rows[0].stationRunId,
    );
  });

  it("walks the stamped clone, never re-reading the blueprint file", async () => {
    // The point of the clone: editing a YAML mid-run must not change the graph a
    // run in flight is walking. The deps here would resolve a DIFFERENT graph, so
    // a walk that consulted them would launch the wrong node.
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
    const { deps, launched } = makeDeps(port);

    deps.definitions = async () => {
      throw new Error("the walk must not read the blueprint file");
    };
    await advanceLine(id, deps);

    expect(launched.map((s) => s.name)).toEqual([
      `${id.substring(0, 12)}-review`,
    ]);
  });

  it("falls back to the blueprint by name for a run stamped before clones existed", async () => {
    // Rows predating the column carry no graph; they must stay walkable, or the
    // migration would strand every run that was open when it was applied.
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      branch: "feat/y",
      args: { description: "Review pull request #8", pr_number: 8 },
    });

    await port.markRunning(id);
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, deps);

    expect((await port.getById(id))?.graph).toBeNull();
    expect(launched.map((s) => s.name)).toEqual([
      `${id.substring(0, 12)}-review`,
    ]);
  });
});

describe("advanceLine", () => {
  it("launches the entry node CR with the row's description in the prompt", async () => {
    const port = new InMemoryAssemblyRuns();
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

  it("dispatches the resumed round's feedback as the CR's description, not just its prompt", async () => {
    // The recipe the pod runs renders {description}; spec.prompt is not what
    // reaches the agent. Setting only the prompt left every resumed round being
    // handed the full draft again — the re-briefing this feature exists to end.
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
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, {
      ...deps,
      resolveConversation: async () => ({
        source: "http://floor/api/agent-conversations",
        id: "round-1",
        pin: "round-2",
        headersSecret: "agent-events-auth",
      }),
    });

    expect(launched[0]).toMatchObject({
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
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, {
      ...deps,
      resolveConversation: async () => ({
        source: "http://floor/api/agent-conversations",
        id: "",
        pin: "round-1",
        headersSecret: "agent-events-auth",
      }),
    });

    expect(launched[0]).toMatchObject({
      description: "the whole draft",
      prompt: "code-review::the whole draft",
    });
  });

  it("records a wait node but launches nothing — its worker is not a pod", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "author-gated",
      repo: "re-cinq/lore",
      branch: "feat/x",
      args: { description: "plan it" },
    });

    await port.markRunning(id);
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, {
      ...deps,
      definitions: async () =>
        new Map<string, AssemblyLine>([["author-gated", authorGated]]),
    });

    // The row exists, so the walk parks on it and the graph can show it — but no CR
    // was dispatched, because the person is the worker.
    expect(port.nodes).toEqual([
      expect.objectContaining({ nodeId: "author", iteration: 1 }),
    ]);
    expect(launched).toEqual([]);
  });

  it("converges a duplicate advance onto one node row and one idempotent launch", async () => {
    const port = new InMemoryAssemblyRuns();
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
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, launched } = makeDeps(port);

    await advanceLine(id, deps);
    launched.length = 0;
    await advanceLine(id, deps);

    expect(launched).toEqual([]);
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
    const port = new InMemoryAssemblyRuns();
    const id = await port.start({
      blueprintName: "code-review",
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
    const port = new InMemoryAssemblyRuns();
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

  it("parks an agent node instead of dispatching it while the account is dry", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, launched } = makeDeps(port);
    const gate = new LlmDispatchGate(() => new Date());

    gate.trip("anthropic-credit", "Credit balance is too low");
    await advanceLine(id, { ...deps, llmGate: gate });

    // No CR, and — the part that matters — no station-run row either. A row with
    // a null outcome is what the reaper reads as "relaunch me", so minting one
    // here would re-dispatch the pod every 60s for the whole outage.
    expect(launched).toEqual([]);
    expect(port.nodes).toEqual([]);
    // Parked, not failed: nobody is told their work died.
    expect(await port.getById(id)).toMatchObject({ status: "running" });
  });

  it("dispatches the node it parked once the account is healthy again", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await runningLine(port);
    const { deps, launched } = makeDeps(port);
    const gate = new LlmDispatchGate(() => new Date());

    gate.trip("anthropic-credit", "Credit balance is too low");
    await advanceLine(id, { ...deps, llmGate: gate });
    gate.clear();
    await advanceLine(id, { ...deps, llmGate: gate });

    expect(launched).toHaveLength(1);
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

describe("taskFromRow", () => {
  it("derives the synthetic taskId for a task-less row and keeps the real one otherwise", async () => {
    const port = new InMemoryAssemblyRuns();
    const taskless = await port.start({
      blueprintName: "code-review",
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
      blueprintName: "implementation",
      repo: "o/r",
      taskId: "task-9",
    });

    expect(taskFromRow((await port.getById(taskful))!)).toMatchObject({
      taskId: "task-9",
      pipelineTaskId: "task-9",
    });
  });
});

// ── Fork-and-rerun (specs/fork-rerun-from-node FR5): the walk itself is
//    untouched — a forked line's inherited rows replay through nextTransition
//    like any other history. What the guard needs is to stop reading "has node
//    rows" as "already started work".
describe("advanceLine on a forked line", () => {
  const HASH = "hash-code-review";

  /** Strictly-increasing clock: the overlap guard breaks a createdAt TIE on the
   *  row ids, which are random uuids — a real coin flip. The port takes an
   *  injectable clock for exactly this, so every line here is unambiguously
   *  ordered and the guard's decision is the only variable under test. */
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

  it("launches the successor of the inherited node, not the entry node", async () => {
    const port = orderedPort();
    const source = await forkableLine(port);
    const forked = await fork(port, source);
    const { deps, launched } = makeDeps(port);

    await advanceLine(forked, deps);

    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({
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
    const { deps, launched } = makeDeps(port);

    await advanceLine(forked, deps);

    expect(launched.map((spec) => spec.name)).not.toContain(
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

  it("fails the line instead of parking it on a PR that cannot exist", async () => {
    const port = new InMemoryAssemblyRuns();
    const id = await pushLine(port);
    const { deps, notified } = makeDeps(port);

    // The pod says it worked; GitHub says the branch is empty. GitHub wins.
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
    // and the author is told, rather than left watching a wait node
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

  it("keeps walking when the stamp failed for a transient reason", async () => {
    // A 502 says nothing about the branch; the reaper re-drives the stamp, and
    // failing the run here would throw away work that is genuinely fine.
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
