import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  assemblyLineReaperJob,
  decideNodeRecovery,
  stationQueueWaitMs,
} from "./assembly-run-reaper.js";
import { LlmDispatchGate } from "./llm-dispatch-gate.js";

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
    on: always
`);

const MIN = 60_000;

const QUEUE_WAIT_MS = 30 * MIN;

describe("decideNodeRecovery", () => {
  const node = (
    ageMinutes: number,
    over: Partial<StationRunRecord> = {},
  ): StationRunRecord => ({
    id: "1",
    stationRunId: "station-run-1",
    assemblyRunId: "al-1",
    nodeId: "review",
    iteration: 1,
    status: "running",
    clusterAgentId: null,
    requiredTags: [],
    claimedAt: null,
    outcome: null,
    failureClass: null,
    failureDetail: null,
    agentCrName: "a1b2c3d4-review",
    input: null,
    commitSha: null,
    startedAt: new Date(Date.now() - ageMinutes * MIN),
    finishedAt: null,
    ...over,
  });
  const nowMs = Date.now();

  const decide = (
    input: Partial<Parameters<typeof decideNodeRecovery>[0]> & {
      node: StationRunRecord;
    },
  ) =>
    decideNodeRecovery({
      timeoutMinutes: 15,
      status: null,
      crVisible: true,
      queueWaitMs: QUEUE_WAIT_MS,
      nowMs,
      ...input,
    });

  it("resolves a terminal CR whose event was dropped", () => {
    const status: AgentNodeStatus = {
      phase: "Succeeded",
      output: "REVIEW_RESULT:APPROVED",
    };

    expect(decide({ node: node(5), status })).toEqual({
      kind: "resolve",
      status,
    });
  });

  it("requeues a claimed node whose CR is missing (crash between claim and CR create)", () => {
    expect(
      decide({
        node: node(3, {
          status: "claimed",
          clusterAgentId: "central-1",
          claimedAt: new Date(nowMs - 3 * MIN),
        }),
      }),
    ).toEqual({ kind: "requeue" });
  });

  it("requeues a legacy running row whose CR is missing past the startup grace", () => {
    // Pre-flip push rows: their dispatch_spec is null so no claim will take
    // them; the queue-wait bound then settles them — acceptable deprecation.
    expect(decide({ node: node(3) })).toEqual({ kind: "requeue" });
  });

  it("times out an open node past its budget, CR present or not", () => {
    expect(decide({ node: node(20) })).toEqual({ kind: "timeout" });
    expect(decide({ node: node(20), status: { phase: "Running" } })).toEqual({
      kind: "timeout",
    });
  });

  it("uses the 60-minute default budget when the definition names none", () => {
    expect(
      decide({
        node: node(50),
        timeoutMinutes: undefined,
        status: { phase: "Running" },
      }),
    ).toEqual({ kind: "wait" });
    expect(
      decide({
        node: node(70),
        timeoutMinutes: undefined,
        status: { phase: "Running" },
      }),
    ).toEqual({ kind: "timeout" });
  });

  it("measures a claimed row's budget from claimed_at, not enqueue time", () => {
    // 60 minutes queued waiting for a capable cluster, 5 minutes executing:
    // the wait is not charged against the 15-minute budget.
    expect(
      decide({
        node: node(60, {
          status: "claimed",
          clusterAgentId: "central-1",
          claimedAt: new Date(nowMs - 5 * MIN),
        }),
        status: { phase: "Running" },
      }),
    ).toEqual({ kind: "wait" });
    expect(
      decide({
        node: node(60, {
          status: "claimed",
          clusterAgentId: "central-1",
          claimedAt: new Date(nowMs - 20 * MIN),
        }),
        status: { phase: "Running" },
      }),
    ).toEqual({ kind: "timeout" });
  });

  it("waits on an in-budget queued row without reading any CR", () => {
    expect(
      decide({ node: node(10, { status: "queued" }), crVisible: false }),
    ).toEqual({ kind: "wait" });
  });

  it("fails a row queued past the queue-wait bound as queue-timeout", () => {
    expect(
      decide({ node: node(45, { status: "queued" }), crVisible: false }),
    ).toEqual({ kind: "queue-timeout" });
  });

  it("waits on an in-budget satellite claim instead of reading its invisible CR", () => {
    // A satellite's CR read would answer null and requeue live work — the
    // double-launch this arm exists to prevent.
    expect(
      decide({
        node: node(3, {
          status: "claimed",
          clusterAgentId: "sat-1",
          claimedAt: new Date(nowMs - 3 * MIN),
        }),
        crVisible: false,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("times out a satellite claim past its budget — a live agent past budget is stuck, not lost", () => {
    expect(
      decide({
        node: node(60, {
          status: "claimed",
          clusterAgentId: "sat-1",
          claimedAt: new Date(nowMs - 20 * MIN),
        }),
        crVisible: false,
      }),
    ).toEqual({ kind: "timeout" });
  });

  it("never times out a node whose worker is a human", async () => {
    // The one test that proves a feature can wait a week. Every other node has a
    // budget because a pod that stops reporting is stuck; a node parked on a person
    // is not stuck, and "how long may someone take to answer" has no defensible
    // number — so the budget does not apply rather than being made very large.
    expect(
      decide({
        node: node(60 * 24 * 7, { agentCrName: null }),
        nodeType: "feature_review",
      }),
    ).toEqual({ kind: "wait" });
  });

  it("still times out an agent node with no CR", async () => {
    // The exemption is keyed on the node TYPE, not on the absence of a CR — a
    // dispatched node that never produced one is exactly the stuck case.
    expect(
      decide({
        node: node(60 * 24 * 7, { agentCrName: null }),
        nodeType: "agent",
      }),
    ).toEqual({ kind: "timeout" });
  });

  it("waits on a just-born CR that reports Pending", () => {
    // The read boundary answers Pending for a CR the controller has not stamped;
    // only a 404 is absence, and only absence may requeue.
    expect(decide({ node: node(5), status: { phase: "Pending" } })).toEqual({
      kind: "wait",
    });
  });

  it("waits out the startup grace before requeueing a missing CR", () => {
    // A tick can land in the real window between the claim and the CR create.
    // Requeueing there races an in-flight provision (mirror of FR-10.4's grace).
    expect(decide({ node: node(1) })).toEqual({ kind: "wait" });
  });

  it("waits on a live in-budget CR", () => {
    expect(decide({ node: node(5), status: { phase: "Running" } })).toEqual({
      kind: "wait",
    });
  });
});

describe("stationQueueWaitMs", () => {
  it("defaults to 30 minutes when LORE_STATION_QUEUE_WAIT_MINUTES is unset", () => {
    delete process.env.LORE_STATION_QUEUE_WAIT_MINUTES;
    expect(stationQueueWaitMs()).toBe(30 * MIN);
  });

  it("honors LORE_STATION_QUEUE_WAIT_MINUTES=5", () => {
    process.env.LORE_STATION_QUEUE_WAIT_MINUTES = "5";

    try {
      expect(stationQueueWaitMs()).toBe(5 * MIN);
    } finally {
      delete process.env.LORE_STATION_QUEUE_WAIT_MINUTES;
    }
  });
});

function harness() {
  const port = new InMemoryAssemblyRuns();
  const enqueued: LoreTaskSpec[] = [];
  const statusByName: Record<string, AgentNodeStatus | null> = {};
  const taskStatusById: Record<string, string | null> = {};
  const billingAlerts: Array<{ repo: string; nodeType: string }> = [];
  const crReads: string[] = [];
  const central = { clusterAgentId: null as string | null };
  // What the walk arms a queued row with — the sweep never launches directly.
  const armDispatch = port.enqueueStationRunDispatch.bind(port);

  port.enqueueStationRunDispatch = async (nodeRowId, dispatchSpec) => {
    enqueued.push(dispatchSpec as LoreTaskSpec);
    await armDispatch(nodeRowId, dispatchSpec);
  };

  const deps = {
    assemblyRuns: port,
    definitions: async () => new Map([["code-review", line]]),
    repoSettings: async () => null,
    resolvePrompt: (ref: string, description: string) =>
      `prompt:${ref}::${description}`,
    cleanupToken: async () => {},
    jobRuns: { complete: async () => {}, fail: async () => {} },
    readAgentStatus: async (name: string) => {
      crReads.push(name);

      return statusByName[name] ?? null;
    },
    taskStatus: async (taskId: string) => taskStatusById[taskId] ?? null,
    centralClusterAgentId: async () => central.clusterAgentId,
    alertBilling: async (repo: string, nodeType: string) => {
      billingAlerts.push({ repo, nodeType });
    },
  };

  return {
    port,
    enqueued,
    statusByName,
    taskStatusById,
    billingAlerts,
    crReads,
    deps,
    central,
  };
}

describe("assemblyLineReaperJob", () => {
  it("resolves a dropped terminal event and advances the line to completion", async () => {
    const h = harness();
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    const crName = `${id.substring(0, 12)}-review`;

    await h.port.ensureStationRun({
      assemblyRunId: id,
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

  it("alerts on a billing failure that arrives through the dropped-event door", async () => {
    const h = harness();
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    const crName = `${id.substring(0, 12)}-review`;

    await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: crName,
    });
    h.statusByName[crName] = {
      phase: "Failed",
      failureReason: "BackoffLimitExceeded",
      output: JSON.stringify({
        type: "result",
        is_error: true,
        result: "Credit balance is too low",
      }),
    };

    await assemblyLineReaperJob({
      ...h.deps,
      llmGate: new LlmDispatchGate(() => new Date()),
    });

    expect(h.billingAlerts).toEqual([{ repo: "o/r", nodeType: "agent" }]);
    expect(h.port.nodes[0]).toMatchObject({
      failureClass: "anthropic-credit",
      failureDetail: "Credit balance is too low",
    });
  });

  it("fails a timed-out node as agent-timeout and routes the failed edge", async () => {
    const h = harness();
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    const old = new Date(Date.now() - 30 * MIN);
    const clock = h.port.clock;

    h.port.clock = () => old;
    await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
    });
    h.port.clock = clock;

    await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes[0]).toMatchObject({
      outcome: "failed",
      // A pod that stopped reporting died; that is infrastructure, not the work
      // failing, and the row has to say so or the run is a blank "failed" again.
      failureClass: "infra",
    });
    expect(h.port.nodes[0]?.failureDetail).toContain("timed out");
    // review --failed--> done: the line completes rather than wedging.
    expect(await h.port.getById(id)).toMatchObject({ status: "finished" });
  });

  it("fails a row stuck queued for over 30 minutes", async () => {
    const h = harness();
    const old = new Date(Date.now() - 45 * MIN);
    const clock = h.port.clock;

    h.port.clock = () => old;
    const id = await h.port.start({
      blueprintName: "code-review",
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
      blueprintName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);

    await assemblyLineReaperJob(h.deps);

    // advanceLine replays: no visits → enqueue the entry node's dispatch.
    expect(h.enqueued).toHaveLength(1);
    expect(h.port.nodes[0]).toMatchObject({ nodeId: "review" });
  });

  it("leaves a single-CR row whose backing task is still running alone", async () => {
    const h = harness();
    const singleCr = await h.port.start({
      blueprintName: "runbook",
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
      blueprintName: "runbook",
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
    expect(h.enqueued).toEqual([]);
  });
});

describe("the sweep's claim-lifecycle arms", () => {
  /** A queued, armed row aged `ageMinutes` past enqueue. */
  const queuedRow = async (
    h: ReturnType<typeof harness>,
    id: string,
    ageMinutes: number,
    requiredTags: string[] = [],
  ) => {
    h.port.clock = () => new Date(Date.now() - ageMinutes * MIN);
    const { nodeRowId } = await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
      status: "queued",
      requiredTags,
    });

    await h.port.enqueueStationRunDispatch(nodeRowId, { name: "spec" });
    h.port.clock = () => new Date();

    return nodeRowId;
  };

  const runningRow = async (h: ReturnType<typeof harness>) => {
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);

    return id;
  };

  it("fails a row queued past the wait bound, naming its unmatched required_tags", async () => {
    const h = harness();
    const id = await runningRow(h);

    await queuedRow(h, id, 45, ["gpu"]);
    const summary = await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes[0]).toMatchObject({
      outcome: "failed",
      failureClass: "infra",
      failureDetail:
        "no registered cluster-agent claimed this run (required_tags: [gpu]) within 30m",
    });
    // review --failed--> done: the line settles rather than wedging.
    expect(await h.port.getById(id)).toMatchObject({ status: "finished" });
    expect(summary).toContain("queue-timed-out 1");
  });

  it("leaves an in-wait queued row alone and never reads its CR", async () => {
    const h = harness();
    const id = await runningRow(h);

    await queuedRow(h, id, 10);
    await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes[0]).toMatchObject({ status: "queued", outcome: null });
    expect(h.crReads).toEqual([]);
  });

  it("never reads a satellite claim's CR — that null would double-launch it", async () => {
    const h = harness();
    const id = await runningRow(h);

    await queuedRow(h, id, 3);
    await h.port.claimNextStationRun({ clusterAgentId: "sat-1", tags: [] });
    await assemblyLineReaperJob(h.deps);

    expect(h.crReads).toEqual([]);
    expect(h.port.nodes[0]).toMatchObject({
      status: "claimed",
      clusterAgentId: "sat-1",
      outcome: null,
    });
  });

  it("requeues the same row when the central claim produced no CR past the grace", async () => {
    const h = harness();

    h.central.clusterAgentId = "central-1";
    const id = await runningRow(h);

    await queuedRow(h, id, 10);
    // The claim is aged past the startup grace too: claimed_at is the clock
    // the grace runs from... startedAt in this arm. The CR read answers null.
    h.port.clock = () => new Date(Date.now() - 5 * MIN);
    await h.port.claimNextStationRun({
      clusterAgentId: "central-1",
      tags: [],
    });
    h.port.clock = () => new Date();
    const summary = await assemblyLineReaperJob(h.deps);

    // Same row, reset — no second row, no second builder: the armed dispatch
    // spec rides the row for the next claimant.
    expect(h.port.nodes).toHaveLength(1);
    expect(h.port.nodes[0]).toMatchObject({
      status: "queued",
      clusterAgentId: null,
      claimedAt: null,
      outcome: null,
    });
    expect(summary).toContain("requeued 1");
    expect(
      await h.port.claimNextStationRun({
        clusterAgentId: "central-1",
        tags: [],
      }),
    ).toMatchObject({ dispatchSpec: { name: "spec" } });
  });

  it("times out an alive-but-stuck satellite claim from claimed_at, terminally", async () => {
    const h = harness();
    const id = await runningRow(h);

    await queuedRow(h, id, 60);
    // Claimed 20 minutes ago against review's 15-minute budget.
    h.port.clock = () => new Date(Date.now() - 20 * MIN);
    await h.port.claimNextStationRun({ clusterAgentId: "sat-1", tags: [] });
    h.port.clock = () => new Date();
    await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes[0]).toMatchObject({
      outcome: "failed",
      failureClass: "infra",
    });
    expect(h.crReads).toEqual([]);
  });
});

describe("the reaper's resolve door delivers artifacts too", () => {
  it("merges a declared artifact when the terminal event was dropped, exactly as the event door does", async () => {
    // A dropped event makes THIS the only door that will ever read the output. An
    // artifact delivered on one door and not the other is a difference nobody
    // could predict from the run.
    const h = harness();
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      taskId: "t1",
      args: {},
    });

    await h.port.markRunning(id);
    const crName = `${id.substring(0, 12)}-review`;

    await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: crName,
    });
    h.statusByName[crName] = {
      phase: "Succeeded",
      output: JSON.stringify({
        source: { task: "t1" },
        event: {
          kind: "file",
          event: "spec.plan",
          path: "target/spec-plan.json",
          content: '{"updates":[]}',
        },
      }),
    };

    await assemblyLineReaperJob(h.deps);

    expect((await h.port.getById(id))?.args).toMatchObject({
      spec_plan: '{"updates":[]}',
    });
  });
});

describe("a node whose station runs in the pooled service", () => {
  const MINUTE = 60_000;
  /** A service dispatch writes no CR name: there is no pod to name. */
  const serviceNode = (ageMinutes: number): StationRunRecord => ({
    id: "1",
    stationRunId: "station-run-1",
    assemblyRunId: "al-1",
    nodeId: "settle",
    iteration: 1,
    status: "running",
    clusterAgentId: null,
    requiredTags: [],
    claimedAt: null,
    outcome: null,
    failureClass: null,
    failureDetail: null,
    agentCrName: null,
    input: null,
    commitSha: null,
    startedAt: new Date(Date.now() - ageMinutes * MINUTE),
    finishedAt: null,
  });

  it("waits rather than relaunching it as a pod, since no pod was ever meant to exist", () => {
    // Relaunching creates an Agent CR for a node the stations service is still
    // holding: `def-merge-step` is seeded nowhere so it errors every tick, and
    // for a type that IS seeded both the pod and the queued delivery would run —
    // duplicate Issues, duplicate episodes.
    expect(
      decideNodeRecovery({
        node: serviceNode(3),
        timeoutMinutes: 5,
        status: null,
        nodeType: "merge_step",
        crVisible: true,
        queueWaitMs: QUEUE_WAIT_MS,
        nowMs: Date.now(),
      }),
    ).toEqual({ kind: "wait" });
  });

  it("still times it out past its budget, so a lost delivery does not park forever", () => {
    expect(
      decideNodeRecovery({
        node: serviceNode(60),
        timeoutMinutes: 5,
        status: null,
        nodeType: "merge_step",
        crVisible: true,
        queueWaitMs: QUEUE_WAIT_MS,
        nowMs: Date.now(),
      }),
    ).toEqual({ kind: "timeout" });
  });

  it("requeues a POD node with no CR, which is the crash-between-claim-and-CR case", () => {
    expect(
      decideNodeRecovery({
        node: { ...serviceNode(3), agentCrName: "a1b2c3d4-validate" },
        timeoutMinutes: 15,
        status: null,
        nodeType: "validate",
        crVisible: true,
        queueWaitMs: QUEUE_WAIT_MS,
        nowMs: Date.now(),
      }),
    ).toEqual({ kind: "requeue" });
  });
});

describe("the offline sweep (FR4)", () => {
  const offlineNode = (
    over: Partial<StationRunRecord> = {},
  ): StationRunRecord => ({
    id: "1",
    stationRunId: "station-run-1",
    assemblyRunId: "al-1",
    nodeId: "review",
    iteration: 1,
    status: "claimed",
    clusterAgentId: "sat-1",
    requiredTags: [],
    claimedAt: new Date(Date.now() - 3 * MIN),
    outcome: null,
    failureClass: null,
    failureDetail: null,
    agentCrName: "a1b2c3d4-review",
    input: null,
    commitSha: null,
    startedAt: new Date(Date.now() - 10 * MIN),
    finishedAt: null,
    ...over,
  });

  it("requeues a claim held by an offline agent immediately, without waiting out the budget", () => {
    expect(
      decideNodeRecovery({
        node: offlineNode(),
        timeoutMinutes: 15,
        status: null,
        crVisible: false,
        claimantOffline: true,
        queueWaitMs: QUEUE_WAIT_MS,
        nowMs: Date.now(),
      }),
    ).toEqual({ kind: "requeue-offline" });
  });

  it("an offline claimant flips nothing on a queued row — there is no claim to lose", () => {
    expect(
      decideNodeRecovery({
        node: offlineNode({
          status: "queued",
          clusterAgentId: null,
          claimedAt: null,
        }),
        timeoutMinutes: 15,
        status: null,
        crVisible: false,
        claimantOffline: true,
        queueWaitMs: QUEUE_WAIT_MS,
        nowMs: Date.now(),
      }),
    ).toEqual({ kind: "wait" });
  });

  it("requeues an offline satellite's claim, same row, and writes the cluster_agent_offline audit entry", async () => {
    const h = harness();
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    const { nodeRowId } = await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
      status: "queued",
    });

    await h.port.enqueueStationRunDispatch(nodeRowId, { name: "spec" });
    await h.port.claimNextStationRun({ clusterAgentId: "sat-1", tags: [] });
    const audits: Array<{
      event_type: string;
      payload: Record<string, unknown>;
    }> = [];
    const cutoffs: Date[] = [];

    const summary = await assemblyLineReaperJob({
      ...h.deps,
      offlineClusterAgents: async (cutoff) => {
        cutoffs.push(cutoff);

        return new Set(["sat-1"]);
      },
      audit: async (entry) => {
        audits.push(entry);
      },
    });

    expect(h.port.nodes).toHaveLength(1);
    expect(h.port.nodes[0]).toMatchObject({
      status: "queued",
      clusterAgentId: null,
      claimedAt: null,
      outcome: null,
    });
    expect(summary).toContain("requeued 1");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      event_type: "cluster_agent_offline",
      payload: {
        cluster_agent_id: "sat-1",
        assembly_run_id: id,
        node_id: "review",
      },
    });
    expect(typeof audits[0].payload.elapsed_since_claim_ms).toBe("number");
    // The sweep asks with the 5-minute threshold: ten missed 30s heartbeats.
    expect(Date.now() - cutoffs[0].getTime()).toBeGreaterThanOrEqual(5 * MIN);
    expect(Date.now() - cutoffs[0].getTime()).toBeLessThan(6 * MIN);
  });

  it("leaves an online satellite's claim alone even when the sweep reports other agents offline", async () => {
    const h = harness();
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    const { nodeRowId } = await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
      status: "queued",
    });

    await h.port.enqueueStationRunDispatch(nodeRowId, { name: "spec" });
    await h.port.claimNextStationRun({ clusterAgentId: "sat-2", tags: [] });

    await assemblyLineReaperJob({
      ...h.deps,
      offlineClusterAgents: async () => new Set(["sat-1"]),
    });

    expect(h.port.nodes[0]).toMatchObject({
      status: "claimed",
      clusterAgentId: "sat-2",
    });
  });
});
