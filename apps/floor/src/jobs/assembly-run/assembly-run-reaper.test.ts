import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import {
  assemblyLineReaperJob,
  decideNodeRecovery,
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

describe("decideNodeRecovery", () => {
  const node = (ageMinutes: number) => ({
    id: "1",
    stationRunId: "station-run-1",
    assemblyRunId: "al-1",
    nodeId: "review",
    iteration: 1,
    outcome: null,
    failureClass: null,
    failureDetail: null,
    agentCrName: "a1b2c3d4-review",
    input: null,
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

  it("never times out a node whose worker is a human", async () => {
    // The one test that proves a feature can wait a week. Every other node has a
    // budget because a pod that stops reporting is stuck; a node parked on a person
    // is not stuck, and "how long may someone take to answer" has no defensible
    // number — so the budget does not apply rather than being made very large.
    expect(
      decideNodeRecovery({
        node: { ...node(60 * 24 * 7), agentCrName: null },
        timeoutMinutes: 15,
        status: null,
        nodeType: "feature_review",
        nowMs,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("still times out an agent node with no CR", async () => {
    // The exemption is keyed on the node TYPE, not on the absence of a CR — a
    // dispatched node that never produced one is exactly the stuck case.
    expect(
      decideNodeRecovery({
        node: { ...node(60 * 24 * 7), agentCrName: null },
        timeoutMinutes: 15,
        status: null,
        nodeType: "agent",
        nowMs,
      }),
    ).toEqual({ kind: "timeout" });
  });

  it("waits on a just-born CR that reports Pending", () => {
    // The read boundary answers Pending for a CR the controller has not stamped;
    // only a 404 is absence, and only absence may relaunch.
    expect(
      decideNodeRecovery({
        node: node(5),
        timeoutMinutes: 15,
        status: { phase: "Pending" },
        nowMs,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("waits out the startup grace before relaunching a missing CR", () => {
    // A tick can land in the real window between the row insert and the CR create.
    // Relaunching there races an in-flight provision (mirror of FR-10.4's grace).
    expect(
      decideNodeRecovery({
        node: node(1),
        timeoutMinutes: 15,
        status: null,
        nowMs,
      }),
    ).toEqual({ kind: "wait" });
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
  const port = new InMemoryAssemblyRuns();
  const launched: LoreTaskSpec[] = [];
  const statusByName: Record<string, AgentNodeStatus | null> = {};
  const taskStatusById: Record<string, string | null> = {};
  const billingAlerts: Array<{ repo: string; nodeType: string }> = [];

  const deps = {
    assemblyRuns: port,
    definitions: async () => new Map([["code-review", line]]),
    launch: async (spec: LoreTaskSpec) => {
      launched.push(spec);
    },
    // Description-sensitive: a relaunch that rebuilt the prompt from the raw task
    // description instead of the round content is invisible to a ref-only stub.
    resolvePrompt: (ref: string, description: string) =>
      `prompt:${ref}::${description}`,
    cleanupToken: async () => {},
    jobRuns: { complete: async () => {}, fail: async () => {} },
    readAgentStatus: async (name: string) => statusByName[name] ?? null,
    taskStatus: async (taskId: string) => taskStatusById[taskId] ?? null,
    alertBilling: async (repo: string, nodeType: string) => {
      billingAlerts.push({ repo, nodeType });
    },
  };

  return { port, launched, statusByName, taskStatusById, billingAlerts, deps };
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

    await assemblyLineReaperJob(h.deps);

    expect(h.billingAlerts).toEqual([{ repo: "o/r", nodeType: "agent" }]);
    expect(h.port.nodes[0]).toMatchObject({
      failureClass: "anthropic-credit",
      failureDetail: "Credit balance is too low",
    });
  });

  it("does not relaunch a missing agent CR while the account is dry", async () => {
    const h = harness();
    const gate = new LlmDispatchGate(() => new Date());
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
    });
    gate.trip("anthropic-credit", "Credit balance is too low");

    // The CR is missing, which normally means "crashed between row and launch,
    // relaunch me" — every 60s, for the whole outage.
    await assemblyLineReaperJob({ ...h.deps, llmGate: gate });

    expect(h.launched).toEqual([]);
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

    // advanceLine replays: no visits → launch the entry node.
    expect(h.launched).toHaveLength(1);
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
    expect(h.launched).toEqual([]);
  });
});

describe("relaunch label parity", () => {
  it("a reaper relaunch carries the SAME station-run id label the first launch did", async () => {
    // The advance path stamps the label from ensureStationRun; a relaunch that
    // dropped it would hand the label's first consumer a pod with no identity.
    const h = harness();
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {},
    });

    await h.port.markRunning(id);
    // Aged past the startup grace: inside it an absent CR reads as "not launched
    // yet" rather than "crashed before launch".
    h.port.clock = () => new Date(Date.now() - 5 * MIN);
    await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
    });
    h.port.clock = () => new Date();
    // No status for the CR name: decideNodeRecovery says relaunch.

    await assemblyLineReaperJob(h.deps);

    expect(h.launched).toHaveLength(1);
    expect(h.launched[0].extraLabels?.["lore.re-cinq.com/station-run-id"]).toBe(
      h.port.nodes[0].stationRunId,
    );
  });
});

describe("a relaunch is the SAME dispatch, not a second builder", () => {
  const conversation = {
    source: "http://floor/api/agent-conversations",
    id: "round-1",
    pin: "round-2",
    headersSecret: "agent-events-auth",
  };

  /** Age the station-run row past the startup grace so the reaper may act on it. */
  const openNodePastGrace = async (
    h: ReturnType<typeof harness>,
    id: string,
    iteration = 1,
  ) => {
    h.port.clock = () => new Date(Date.now() - 5 * MIN);
    await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration,
      agentCrName: `${id.substring(0, 12)}-review`,
    });
    h.port.clock = () => new Date();
  };

  it("a relaunch resumes the same conversation the first dispatch resolved", async () => {
    // The reaper rebuilt the spec field by field and forgot the conversation; the
    // launch then RE-PROVISIONED the per-task clone without it, deleting continuity
    // from a live pod (#1466). One builder, one spec.
    const h = harness();
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {
        description: "the whole draft",
        round_feedback: '<RoundFeedback round="2"/>',
      },
    });

    await h.port.markRunning(id);
    await openNodePastGrace(h, id);
    await assemblyLineReaperJob({
      ...h.deps,
      resolveConversation: async () => conversation,
    });

    expect(h.launched).toHaveLength(1);
    expect(h.launched[0]).toMatchObject({
      conversation,
      // A resumed round sends only the new feedback — the same round content the
      // first dispatch computed, in BOTH the description and the prompt.
      description: '<RoundFeedback round="2"/>',
      prompt: 'prompt:code-review::<RoundFeedback round="2"/>',
    });
  });

  it("a relaunch of a round that resumed nothing carries the full composition", async () => {
    const h = harness();
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: {
        description: "the whole draft",
        round_feedback: '<RoundFeedback round="1"/>',
      },
    });

    await h.port.markRunning(id);
    await openNodePastGrace(h, id);
    await assemblyLineReaperJob({
      ...h.deps,
      resolveConversation: async () => ({ ...conversation, id: "" }),
    });

    expect(h.launched[0]).toMatchObject({ description: "the whole draft" });
  });

  it("a retry relaunch reports the failed prior visit, not the open row, as the prior outcome", async () => {
    // A retry must NOT continue: the prior outcome decides that, and reading it off
    // the open row (outcome null) would make every retry inherit a failed attempt.
    const h = harness();
    const seen: Array<string | null> = [];
    const id = await h.port.start({
      blueprintName: "code-review",
      repo: "o/r",
      args: { description: "d" },
    });

    await h.port.markRunning(id);
    h.port.clock = () => new Date(Date.now() - 9 * MIN);
    const first = await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-review`,
    });

    await h.port.finishStationRunOnce(first.nodeRowId, "failed");
    await openNodePastGrace(h, id, 2);
    await assemblyLineReaperJob({
      ...h.deps,
      resolveConversation: async (_node, _task, _iteration, priorOutcome) => {
        seen.push(priorOutcome);

        return undefined;
      },
    });

    expect(seen).toEqual(["failed"]);
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
  const serviceNode = (ageMinutes: number) => ({
    id: "1",
    stationRunId: "station-run-1",
    assemblyRunId: "al-1",
    nodeId: "settle",
    iteration: 1,
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
        nowMs: Date.now(),
      }),
    ).toEqual({ kind: "timeout" });
  });

  it("relaunches a POD node with no CR, which is the crash-between-row-and-launch case", () => {
    expect(
      decideNodeRecovery({
        node: { ...serviceNode(3), agentCrName: "a1b2c3d4-validate" },
        timeoutMinutes: 15,
        status: null,
        nodeType: "validate",
        nowMs: Date.now(),
      }),
    ).toEqual({ kind: "relaunch" });
  });
});
