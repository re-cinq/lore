import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  loadBuiltinAssemblyLines,
  parseAssemblyLine,
  type AssemblyLine,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { ClusterAgent } from "@re-cinq/lore-shared/models/cluster-agent.js";
import {
  assemblyLineReaperJob,
  decideNodeRecovery,
  stationQueueWaitMs,
} from "./assembly-run-reaper.js";
import { LlmDispatchGate } from "./llm-dispatch-gate.js";
import { advanceLine } from "./advance-line.js";

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

const clusterAgent = (
  name: string,
  tags: string[],
  overrides: Partial<ClusterAgent> = {},
): ClusterAgent => ({
  id: `id-${name}`,
  name,
  tags,
  tokenHash: "hash",
  registeredAt: new Date(),
  lastSeenAt: new Date(),
  status: "active",
  paused: false,
  clusterInfo: null,
  catalogCursor: null,
  ...overrides,
});

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

  it("requeues a legacy running row whose CR is missing past the startup grace (pre-flip push rows have no dispatch_spec, so the queue-wait bound settles them)", () => {
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

  it("waits on an in-budget satellite claim instead of reading its invisible CR, which would answer null and double-launch live work", () => {
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

  it("never times out a node whose worker is a human, since a person parked on a review is not a stuck pod", async () => {
    expect(
      decide({
        node: node(60 * 24 * 7, { agentCrName: null }),
        nodeType: "feature_review",
      }),
    ).toEqual({ kind: "wait" });
  });

  it("still times out an agent node with no CR, since the human exemption is keyed on node type, not CR absence", async () => {
    expect(
      decide({
        node: node(60 * 24 * 7, { agentCrName: null }),
        nodeType: "agent",
      }),
    ).toEqual({ kind: "timeout" });
  });

  it("waits on a just-born CR that reports Pending, since only a 404 counts as absence", () => {
    expect(decide({ node: node(5), status: { phase: "Pending" } })).toEqual({
      kind: "wait",
    });
  });

  it("waits out the startup grace before requeueing a missing CR, since requeueing there races an in-flight provision (mirror of FR-10.4's grace)", () => {
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
  const registry = { agents: [] as ClusterAgent[] };
  const offline = new Set<string>();
  const audits: Array<{
    event_type: string;
    payload: Record<string, unknown>;
  }> = [];
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
    listClusterAgents: async () => registry.agents,
    centralClusterAgentId: async () => central.clusterAgentId,
    offlineClusterAgents: async () => offline,
    audit: async (entry: {
      event_type: string;
      payload: Record<string, unknown>;
    }) => {
      audits.push(entry);
    },
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
    offline,
    audits,
    registry,
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

  it("fails a timed-out node as agent-timeout (infra, not a work failure) and routes the failed edge", async () => {
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
      failureClass: "infra",
    });
    expect(h.port.nodes[0]?.failureDetail).toContain("timed out");
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
    h.taskStatusById["task-1"] = "pr-created";
    await assemblyLineReaperJob(h.deps);

    expect(await h.port.getById(singleCr)).toMatchObject({
      status: "finished",
      outcome: "pr_created",
    });
    expect(h.enqueued).toEqual([]);
  });

  it("closes the single-CR run's open station row, not just the run, so a finished run never reads as still executing a station", async () => {
    const h = harness();
    const singleCr = await h.port.start({
      blueprintName: "runbook",
      repo: "o/r",
      taskId: "task-1",
    });

    await h.port.markRunning(singleCr);
    await h.port.ensureStationRun({
      assemblyRunId: singleCr,
      nodeId: "agent",
      iteration: 1,
      status: "queued",
      requiredTags: ["node:agent"],
    });
    h.taskStatusById["task-1"] = "pr-created";
    await assemblyLineReaperJob(h.deps);

    expect(await h.port.listStationRuns(singleCr)).toMatchObject([
      { nodeId: "agent", outcome: "success" },
    ]);
  });

  it("fails a single-CR run nobody claimed, naming the tags that went unmatched, since a single-CR row has no graph and thus no node budget", async () => {
    const h = harness();
    const singleCr = await h.port.start({
      blueprintName: "runbook",
      repo: "o/r",
      taskId: "task-1",
    });

    await h.port.markRunning(singleCr);
    const { nodeRowId } = await h.port.ensureStationRun({
      assemblyRunId: singleCr,
      nodeId: "agent",
      iteration: 1,
      status: "queued",
      requiredTags: ["node:agent", "gpu"],
      dispatchSpec: { taskId: "task-1" },
    });

    h.taskStatusById["task-1"] = "running";
    h.port.nodes.find((n) => n.id === nodeRowId)!.startedAt = new Date(
      Date.now() - 45 * 60_000,
    );
    await assemblyLineReaperJob(h.deps);

    expect(await h.port.getById(singleCr)).toMatchObject({
      status: "failed",
      outcome: "error",
    });
    expect(await h.port.listStationRuns(singleCr)).toMatchObject([
      { outcome: "failed", failureClass: "unclaimed" },
    ]);
    expect((await h.port.listStationRuns(singleCr))[0].failureDetail).toMatch(
      /node:agent, gpu/,
    );
  });

  it("requeues a single-CR visit whose claiming cluster went offline", async () => {
    const h = harness();
    const singleCr = await h.port.start({
      blueprintName: "runbook",
      repo: "o/r",
      taskId: "task-1",
    });

    await h.port.markRunning(singleCr);
    const { nodeRowId } = await h.port.ensureStationRun({
      assemblyRunId: singleCr,
      nodeId: "agent",
      iteration: 1,
      status: "queued",
      requiredTags: [],
      dispatchSpec: { taskId: "task-1" },
    });
    const claimed = await h.port.claimNextStationRun({
      clusterAgentId: "dead-cluster",
      tags: [],
    });

    expect(claimed?.nodeRowId).toBe(nodeRowId);
    h.taskStatusById["task-1"] = "running";
    h.offline.add("dead-cluster");
    await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes.find((n) => n.id === nodeRowId)).toMatchObject({
      status: "queued",
      clusterAgentId: null,
      outcome: null,
    });
    expect(h.audits.map((entry) => entry.event_type)).toEqual([
      "cluster_agent_offline",
    ]);
  });
});

describe("the sweep's claim-lifecycle arms", () => {
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

  it("fails a row queued past the wait bound as unclaimed, not infra, since no pod was ever created", async () => {
    const h = harness();
    const id = await runningRow(h);

    await queuedRow(h, id, 45, ["gpu"]);
    const summary = await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes[0]).toMatchObject({
      outcome: "failed",
      failureClass: "unclaimed",
      failureDetail:
        "no cluster-agent claimed this run (required_tags: [gpu]) within 30m — no cluster-agent has ever registered",
    });
    expect(await h.port.getById(id)).toMatchObject({ status: "finished" });
    expect(summary).toContain("queue-timed-out 1");
  });

  it("names the paused cluster that could have claimed it, rather than blaming an absent one (#1648/#1654)", async () => {
    const h = harness();
    const id = await runningRow(h);

    h.registry.agents = [
      clusterAgent("central", ["node:review", "node:validate"], {
        paused: true,
      }),
      clusterAgent("satellite", ["node:agent"]),
    ];
    await queuedRow(h, id, 45, ["node:review"]);
    await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes[0]?.failureDetail).toBe(
      "no cluster-agent claimed this run (required_tags: [node:review]) within 30m — every cluster-agent offering [node:review] is unavailable: central (paused)",
    );
  });

  it("says a capable cluster ignored it when one was up the whole time", async () => {
    const h = harness();
    const id = await runningRow(h);

    h.registry.agents = [clusterAgent("central", ["node:review"])];
    await queuedRow(h, id, 45, ["node:review"]);
    await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes[0]?.failureDetail).toContain(
      "1 capable cluster-agent (central) was active but did not claim it",
    );
  });

  it("reads the registry AFTER the offline sweep mutates it, so a just-dead cluster reads offline, not wedged", async () => {
    const h = harness();
    const id = await runningRow(h);

    h.registry.agents = [clusterAgent("central", ["node:review"])];
    h.deps.offlineClusterAgents = async () => {
      h.registry.agents = h.registry.agents.map((agent) => ({
        ...agent,
        status: "offline" as const,
      }));

      return new Set(h.registry.agents.map((agent) => agent.id));
    };
    await queuedRow(h, id, 45, ["node:review"]);
    await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes[0]?.failureDetail).toContain("central (offline)");
    expect(h.port.nodes[0]?.failureDetail).not.toContain("wedged");
  });

  it("bounds the wait by the injected queueWaitMs rather than the ambient env", async () => {
    const h = harness();
    const id = await runningRow(h);

    await queuedRow(h, id, 10);
    await assemblyLineReaperJob({ ...h.deps, queueWaitMs: 5 * MIN });

    expect(h.port.nodes[0]).toMatchObject({ failureClass: "unclaimed" });
    expect(h.port.nodes[0]?.failureDetail).toContain("within 5m");
  });

  it("reads the clock through the injected now, so a sweep can be aged without waiting", async () => {
    const h = harness();
    const id = await runningRow(h);

    await queuedRow(h, id, 0);
    await assemblyLineReaperJob({
      ...h.deps,
      now: () => new Date(Date.now() + 45 * MIN),
    });

    expect(h.port.nodes[0]).toMatchObject({ failureClass: "unclaimed" });
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

  it("requeues the same row when the central claim produced no CR past the grace (claimed_at is the clock the grace runs from in this arm)", async () => {
    const h = harness();

    h.central.clusterAgentId = "central-1";
    const id = await runningRow(h);

    await queuedRow(h, id, 10);
    h.port.clock = () => new Date(Date.now() - 5 * MIN);
    await h.port.claimNextStationRun({
      clusterAgentId: "central-1",
      tags: [],
    });
    h.port.clock = () => new Date();
    const summary = await assemblyLineReaperJob(h.deps);

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
  it("merges a declared artifact when the terminal event was dropped, exactly as the event door does, since a dropped event makes this the only door that reads the output", async () => {
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

  it("waits rather than relaunching it as a pod, since no pod was ever meant to exist and relaunching would double-deliver (def-merge-step isn't even seeded)", () => {
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

describe("the reaper's resolve and timeout doors", () => {
  const validateLine: AssemblyLine = parseAssemblyLine(`
name: with-validate
description: validate → done
version: 1
entry: check
exit: done
nodes:
  - id: check
    type: validate
  - id: done
    type: retrospective
edges:
  - from: check
    to: done
    on: success
  - from: check
    to: done
    on: always
`);

  it("names the validate station's 15-minute budget, not the global 60, when the YAML is silent (message used to quote the global default and contradict the visible clock)", async () => {
    const h = harness();
    const deps = {
      ...h.deps,
      definitions: async () => new Map([["with-validate", validateLine]]),
    };
    const id = await h.port.start({
      blueprintName: "with-validate",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    const clock = h.port.clock;

    h.port.clock = () => new Date(Date.now() - 30 * MIN);
    await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "check",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-check`,
    });
    h.port.clock = clock;

    await assemblyLineReaperJob(deps);

    expect(h.port.nodes[0]?.failureDetail).toBe(
      "station node timed out after 15 minutes without reporting",
    );
  });

  it("raises the agent-config alert on a failed node the resolve door recovers, matching the event door which raises both billing and config", async () => {
    const h = harness();
    const configAlerts: Array<{ repo: string; nodeType: string }> = [];
    const deps = {
      ...h.deps,
      alertAgentConfig: async (repo: string, nodeType: string) => {
        configAlerts.push({ repo, nodeType });
      },
    };
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
      failureReason: "skills_source unreachable",
    };

    await assemblyLineReaperJob(deps);

    expect(configAlerts).toEqual([{ repo: "o/r", nodeType: "agent" }]);
  });
});

describe("a claimed single-CR visit the sweep must NOT own", () => {
  it("leaves a claimed single-CR visit alone past its budget, because the watcher settles it and acting here would race the terminal event", async () => {
    const h = harness();
    const singleCr = await h.port.start({
      blueprintName: "runbook",
      repo: "o/r",
      taskId: "task-1",
    });

    await h.port.markRunning(singleCr);
    const { nodeRowId } = await h.port.ensureStationRun({
      assemblyRunId: singleCr,
      nodeId: "agent",
      iteration: 1,
      status: "queued",
      requiredTags: [],
      dispatchSpec: { taskId: "task-1" },
    });

    await h.port.claimNextStationRun({
      clusterAgentId: "some-cluster",
      tags: [],
    });
    const node = h.port.nodes.find((n) => n.id === nodeRowId)!;

    node.claimedAt = new Date(Date.now() - 24 * 60 * 60_000);
    h.taskStatusById["task-1"] = "running";
    await assemblyLineReaperJob(h.deps);

    expect(h.port.nodes.find((n) => n.id === nodeRowId)).toMatchObject({
      status: "claimed",
      outcome: null,
    });
    expect(await h.port.getById(singleCr)).toMatchObject({ status: "running" });
  });
});

describe("the implementation line's unclaimed validate node", () => {
  it("fails the run once and never re-dispatches implement (2026-08-29 incident: validate needed a tag only paused central offered)", async () => {
    const h = harness();
    const builtins = await loadBuiltinAssemblyLines();

    h.deps.definitions = async () => builtins;
    h.registry.agents = [
      clusterAgent("central", ["node:agent", "node:validate"], {
        paused: true,
      }),
      clusterAgent("satellite", ["node:agent"]),
    ];
    const id = await h.port.start({
      blueprintName: "implementation",
      repo: "re-cinq/lore",
      branch: "lore/impl/1650",
      args: { description: "the ticket" },
    });

    await h.port.markRunning(id);

    for (const nodeId of ["implement"]) {
      const row = await h.port.ensureStationRun({
        assemblyRunId: id,
        nodeId,
        iteration: 1,
        agentCrName: `${id.substring(0, 12)}-${nodeId}`,
      });

      await h.port.finishStationRunOnce(row.nodeRowId, "success");
      await advanceLine(id, h.deps);
    }

    expect(h.port.nodes.at(-1)).toMatchObject({
      nodeId: "validate",
      status: "queued",
    });

    await assemblyLineReaperJob({
      ...h.deps,
      now: () => new Date(Date.now() + 45 * MIN),
    });

    expect(await h.port.getById(id)).toMatchObject({
      status: "failed",
      outcome: "error",
    });
    expect(await h.port.getById(id)).toMatchObject({
      reason: expect.stringContaining("central (paused)"),
    });
    expect(h.port.nodes.map((n) => `${n.nodeId}:${n.iteration}`)).toEqual([
      "implement:1",
      "validate:1",
    ]);
    expect(h.enqueued.map((spec) => spec.name)).not.toContain(
      `${id.substring(0, 12)}-implement-2`,
    );
  });
});
