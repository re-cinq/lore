import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import { createNodeEventHandler } from "./node-event-handler.js";
import { BillingAlertThrottle, maybeAlertBilling } from "./billing-alert.js";
import { maybeAlertAgentConfig } from "./agent-config-alert.js";
import { LlmDispatchGate } from "./llm-dispatch-gate.js";

const line: AssemblyLine = parseAssemblyLine(`
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

function harness() {
  const port = new InMemoryAssemblyRuns();
  const launched: LoreTaskSpec[] = [];
  const statusByName: Record<string, AgentNodeStatus | null> = {};
  const billingAlerts: Array<{ repo: string; nodeType: string }> = [];
  const agentConfigAlerts: Array<{ repo: string; nodeType: string }> = [];
  const armDispatch = port.enqueueStationRunDispatch.bind(port);

  port.enqueueStationRunDispatch = async (nodeRowId, dispatchSpec) => {
    launched.push(dispatchSpec as LoreTaskSpec);
    await armDispatch(nodeRowId, dispatchSpec);
  };
  const deps = {
    assemblyRuns: port,
    definitions: async () => new Map([["code-review", line]]),
    repoSettings: async () => null,
    resolvePrompt: (ref: string) => `prompt:${ref}`,
    cleanupToken: async () => {},
    jobRuns: { complete: async () => {}, fail: async () => {} },
    readAgentStatus: async (name: string) => statusByName[name] ?? null,
    alertBilling: async (repo: string, nodeType: string) => {
      billingAlerts.push({ repo, nodeType });
    },
    alertAgentConfig: async (repo: string, nodeType: string) => {
      agentConfigAlerts.push({ repo, nodeType });
    },
  };

  return {
    port,
    launched,
    statusByName,
    agentConfigAlerts,
    billingAlerts,
    deps,
    handler: createNodeEventHandler(deps),
  };
}

/**
 * The same handler with the REAL `maybeAlertBilling` behind the seam instead of
 * a recorder.
 *
 * This composition is the one nobody tested, and the gap was the bug (#1455):
 * `billing-alert.test.ts` fed the pure function raw NDJSON, `harness()` above
 * stubs the seam out entirely, and in between them the handler normalizes the
 * status — destroying the very result line the alert needed. Both suites were
 * green for months while the alert never fired once in production.
 */
function alertingHarness() {
  const port = new InMemoryAssemblyRuns();
  const sent: string[] = [];
  const statusByName: Record<string, AgentNodeStatus | null> = {};
  const handler = createNodeEventHandler({
    assemblyRuns: port,
    definitions: async () => new Map([["code-review", line]]),
    repoSettings: async () => null,
    resolvePrompt: (ref) => `prompt:${ref}`,
    cleanupToken: async () => {},
    jobRuns: { complete: async () => {}, fail: async () => {} },
    readAgentStatus: async (name) => statusByName[name] ?? null,
    alertBilling: async (repo, nodeType, status) => {
      await maybeAlertBilling(repo, nodeType, status, {
        notify: async (_level, message) => {
          sent.push(message);
        },
        throttle: new BillingAlertThrottle(60_000, () => 0),
      });
    },
    alertAgentConfig: async (repo, nodeType, status) => {
      await maybeAlertAgentConfig(repo, nodeType, status, {
        notify: async (_level, message) => {
          sent.push(message);
        },
        throttle: new BillingAlertThrottle(60_000, () => 0),
      });
    },
  });

  return { port, sent, statusByName, handler, launched: [] as LoreTaskSpec[] };
}

async function reviewInFlight(h: ReturnType<typeof harness>) {
  const id = await h.port.start({
    blueprintName: "code-review",
    repo: "o/r",
    branch: "b",
    args: { description: "Review PR #7" },
  });

  await h.port.markRunning(id);
  const crName = `${id.substring(0, 12)}-review`;

  await h.port.ensureStationRun({
    assemblyRunId: id,
    nodeId: "review",
    iteration: 1,
    agentCrName: crName,
  });

  return { id, crName };
}

const params = (id: string, crName: string, phase = "Succeeded") => ({
  assemblyLineId: id,
  nodeId: "review",
  agentName: crName,
  taskId: id,
  phase,
});

describe("createNodeEventHandler", () => {
  it("routes a REVIEW_RESULT:CHANGES_REQUESTED review node to refine", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = {
      phase: "Succeeded",
      output: "notes\nREVIEW_RESULT:CHANGES_REQUESTED: fix the null check",
    };
    await h.handler(params(id, crName));

    expect(h.port.nodes.map((n) => [n.nodeId, n.outcome])).toEqual([
      ["review", "changes_requested"],
      ["refine", null],
    ]);
    expect(h.launched.at(-1)?.name).toBe(`${id.substring(0, 12)}-refine`);
  });

  it("fires the billing alert with the repo + node type when a node CR fails", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = {
      phase: "Failed",
      failureReason: "BackoffLimitExceeded",
      output:
        '{"type":"result","is_error":true,"result":"Credit balance is too low"}',
    };
    await h.handler(params(id, crName, "Failed"));

    expect(h.billingAlerts).toEqual([{ repo: "o/r", nodeType: "agent" }]);
  });

  it("fires the agent-config alert when the CR's settings file is missing", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = {
      phase: "Failed",
      failureReason: "BackoffLimitExceeded",
      output:
        '{"kind":"lifecycle","phase":"agent","status":"started"}\n' +
        "[agent] Error: Settings file not found: /agent/.claude/settings.json\n" +
        '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
    };
    await h.handler(params(id, crName, "Failed"));

    expect(h.agentConfigAlerts).toEqual([{ repo: "o/r", nodeType: "agent" }]);
  });

  it("alerts through the real billing path when the pod died out of credits", async () => {
    const h = alertingHarness();
    const { id, crName } = await reviewInFlight(
      h as unknown as ReturnType<typeof harness>,
    );

    // Exactly what the cluster wrote for agent-job-3f05f9c7-cd2-analyze-2.
    h.statusByName[crName] = {
      phase: "Failed",
      failureReason:
        "BackoffLimitExceeded: Job has reached the specified backoff limit",
      output: [
        JSON.stringify({
          type: "result",
          is_error: true,
          subtype: "success",
          terminal_reason: "api_error",
          api_error_status: 400,
          result: "Credit balance is too low",
        }),
        JSON.stringify({ kind: "lifecycle", exitCode: 1, status: "failed" }),
      ].join("\n"),
    };
    await h.handler(params(id, crName, "Failed"));

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain("Credit balance is too low");
    expect(h.sent[0]).toContain("out of credits");
  });

  it("alerts through the real agent-config path when the CR's settings file is missing", async () => {
    const h = alertingHarness();
    const { id, crName } = await reviewInFlight(
      h as unknown as ReturnType<typeof harness>,
    );

    // Exactly what the cluster wrote when skills_source pointed nowhere
    // reachable — claude never reaches a result line at all.
    h.statusByName[crName] = {
      phase: "Failed",
      failureReason:
        "BackoffLimitExceeded: Job has reached the specified backoff limit",
      output: [
        JSON.stringify({
          kind: "lifecycle",
          phase: "agent",
          status: "started",
        }),
        "[agent] Error: Settings file not found: /agent/.claude/settings.json",
        JSON.stringify({
          kind: "lifecycle",
          exitCode: 1,
          phase: "agent",
          status: "failed",
        }),
      ].join("\n"),
    };
    await h.handler(params(id, crName, "Failed"));

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain("Settings file not found");
    expect(h.sent[0]).toContain("skills_source");
  });

  it("trips the dispatch gate when a node died of a dry account", async () => {
    const h = harness();
    const gate = new LlmDispatchGate(() => new Date());
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = {
      phase: "Failed",
      failureReason: "BackoffLimitExceeded",
      output: JSON.stringify({
        type: "result",
        is_error: true,
        result: "Credit balance is too low",
      }),
    };
    await createNodeEventHandler({ ...h.deps, llmGate: gate })(
      params(id, crName, "Failed"),
    );

    expect(gate.isBlocked()).toEqual(true);
  });

  it("leaves the dispatch gate alone for a failure that is only this run's", async () => {
    const h = harness();
    const gate = new LlmDispatchGate(() => new Date());
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = {
      phase: "Failed",
      failureReason: "OOMKilled",
    };
    await createNodeEventHandler({ ...h.deps, llmGate: gate })(
      params(id, crName, "Failed"),
    );

    expect(gate.isBlocked()).toEqual(false);
  });

  it("does not fire the billing alert on a successful node", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = {
      phase: "Succeeded",
      output: "REVIEW_RESULT:APPROVED",
    };
    await h.handler(params(id, crName));

    expect(h.billingAlerts).toEqual([]);
  });

  it("finishes the line completed on an approved review", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = {
      phase: "Succeeded",
      output: "REVIEW_RESULT:APPROVED",
    };
    await h.handler(params(id, crName));

    expect(await h.port.getById(id)).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
  });

  // Production hands the handler an NDJSON stream, not the bare marker the cases
  // above use — the outcome must come out identical either way.
  it("routes a review node whose outcome arrives inside an NDJSON envelope", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = {
      phase: "Succeeded",
      output: [
        JSON.stringify({ type: "log", message: "cloning" }),
        JSON.stringify({
          type: "result",
          is_error: false,
          result: "notes\nREVIEW_RESULT:CHANGES_REQUESTED: fix the null check",
        }),
      ].join("\n"),
    };
    await h.handler(params(id, crName));

    expect(h.port.nodes.map((n) => [n.nodeId, n.outcome])).toEqual([
      ["review", "changes_requested"],
      ["refine", null],
    ]);
  });

  it("resolves from the event's reported status without reading the CR back", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    h.deps.readAgentStatus = async () => {
      throw new Error(
        "readAgentStatus must not be called when status is reported",
      );
    };
    await h.handler({
      ...params(id, crName),
      status: { phase: "Succeeded", output: "notes\nREVIEW_RESULT:APPROVED" },
    });

    expect(h.port.nodes[0]).toMatchObject({ outcome: "success" });
    expect(await h.port.getById(id)).toMatchObject({ status: "finished" });
  });

  it("uses the reported status even for a CR claimed by an unreachable cluster", async () => {
    // The exact case that stranded PR #1599's review: a satellite-claimed CR
    // this Floor's central-only read cannot see. Reporting the status on the
    // event itself makes the visibility gate irrelevant for this event.
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    h.port.nodes[0].clusterAgentId = "satellite-1";
    h.deps.readAgentStatus = async () => null;
    await h.handler({
      ...params(id, crName),
      status: { phase: "Succeeded", output: "notes\nREVIEW_RESULT:APPROVED" },
    });

    expect(h.port.nodes[0]).toMatchObject({ outcome: "success" });
  });

  it("falls back to the event's phase when the CR is already pruned (404)", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    // No status registered → readAgentStatus returns null → phase decides.
    await h.handler(params(id, crName, "Failed"));

    expect(h.port.nodes[0]).toMatchObject({ outcome: "failed" });
    expect(await h.port.getById(id)).toMatchObject({ status: "finished" });
  });

  it("ignores events for rows that are no longer running", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    await h.port.finish(id, "pr_closed");
    await h.handler(params(id, crName));

    expect(h.port.nodes[0]).toMatchObject({ outcome: null });
    expect(h.launched).toEqual([]);
  });

  it("is a no-op on redelivery after the node already finished", async () => {
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = {
      phase: "Succeeded",
      output: "REVIEW_RESULT:APPROVED",
    };
    await h.handler(params(id, crName));
    await h.handler(params(id, crName));

    expect(h.port.nodes).toHaveLength(1);
    expect(await h.port.getById(id)).toMatchObject({ outcome: "completed" });
  });

  it("does not read the central cluster's CR when a duplicate event arrives for a node a satellite already settled while the line is still running", async () => {
    // Scenario: "review" settles with changes_requested → walk advances to "refine"
    // (run still "running"). A duplicate terminal event for "review" then arrives
    // WITHOUT params.status — the form an old cluster-agent sends. Because the
    // satellite's CR lives in a cluster the central Floor cannot reach,
    // readAgentStatus would answer null. The fallback converts that null to
    // { phase: "Succeeded" }, which degrades "the satellite produced
    // REVIEW_RESULT:CHANGES_REQUESTED" into "Succeeded with no output" — a
    // phantom re-settlement the reaper already closed correctly. The handler
    // must detect that no open station-run row exists for this node (it was
    // settled on the first delivery) and return without interrogating any cluster.
    const h = harness();
    const { id, crName } = await reviewInFlight(h);

    // First delivery: settle "review" → walk advances to "refine"
    h.statusByName[crName] = {
      phase: "Succeeded",
      output: "notes\nREVIEW_RESULT:CHANGES_REQUESTED: fix the null check",
    };
    await h.handler(params(id, crName));
    expect(await h.port.getById(id)).toMatchObject({ status: "running" });
    expect(h.port.nodes[0]).toMatchObject({
      nodeId: "review",
      outcome: "changes_requested",
    });

    // Duplicate delivery without params.status — record any central CR reads
    const crReads: string[] = [];

    h.deps.readAgentStatus = async (name) => {
      crReads.push(name);
      return null; // satellite's CR is not visible from the central cluster
    };
    await h.handler(params(id, crName));

    // The satellite ran this node — the Floor must not read the central cluster's CR
    expect(crReads).toEqual([]);
  });
});

describe("a declared artifact is delivered before the walk advances", () => {
  const fileLine = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      source: { task: "t1" },
      event: {
        kind: "file",
        event: "spec.plan",
        path: "target/spec-plan.json",
        content: '{"updates":[]}',
        ...over,
      },
    });

  const openRun = async (h: ReturnType<typeof harness>, output: string) => {
    const { id, crName } = await reviewInFlight(h);

    h.statusByName[crName] = { phase: "Succeeded", output };

    return { id, crName };
  };

  it("merges a declared artifact from the terminal status into the line's args before the walk advances", async () => {
    const h = harness();
    const { id, crName } = await openRun(h, `{"type":"log"}\n${fileLine()}`);

    await h.handler(params(id, crName));

    expect((await h.port.getById(id))?.args).toMatchObject({
      spec_plan: '{"updates":[]}',
    });
  });

  it("a sink delivery that already merged the artifact leaves the terminal merge a no-op", async () => {
    const h = harness();
    const { id, crName } = await openRun(h, fileLine());

    // The sink is the fast path and normally wins; the terminal merge writes the
    // same content, so ordering between them changes nothing.
    await h.port.mergeArgs(id, { spec_plan: '{"updates":[]}' });
    await h.handler(params(id, crName));

    expect((await h.port.getById(id))?.args).toMatchObject({
      spec_plan: '{"updates":[]}',
    });
  });

  it("fails the node when its declared artifact was never produced, instead of advancing without it", async () => {
    const h = harness();
    const { id, crName } = await openRun(
      h,
      fileLine({ content: null, reason: "file not found" }),
    );

    await h.handler(params(id, crName));

    const visits = await h.port.listStationRuns(id);

    expect(visits[0]).toMatchObject({ outcome: "failed" });
    expect(visits[0].failureDetail).toContain("spec.plan (file not found)");
  });
});

describe("a delivering node that pushed nothing", () => {
  // The deterministic half of the same fix: an implement node that ends with
  // an empty branch is not a success, whatever it printed. Caught HERE, right
  // after the node, rather than two nodes later at push — validate would
  // otherwise diff an empty branch and lint the whole tree for nothing.
  const implLine: AssemblyLine = parseAssemblyLine(`
name: implementation-loop
description: implement -> validate
version: 1
entry: implement
exit: done
nodes:
  - id: implement
    type: agent
    prompt_ref: implementation-tdd
    station_ref: implementation-tdd
  - id: validate
    type: validate
  - id: done
    type: retrospective
edges:
  - from: implement
    to: validate
    on: success
  - from: implement
    to: implement
    on: failed
    iteration_max: 1
  - from: implement
    to: done
    on: changes_requested
  - from: validate
    to: done
    on: always
`);

  async function implementRun(commitCount: number | null) {
    const h = harness();
    const calls: Array<{ repo: string; branch: string }> = [];

    h.deps.definitions = async () =>
      new Map([["implementation-loop", implLine]]);

    if (commitCount !== null) {
      (h.deps as Record<string, unknown>).deliveredChangeCount = async (
        repo: string,
        branch: string,
      ) => {
        calls.push({ repo, branch });

        return commitCount;
      };
    }
    const id = await h.port.start({
      blueprintName: "implementation-loop",
      repo: "o/r",
      branch: "lore/implementation-loop/x",
      args: {},
    });

    await h.port.markRunning(id);
    await h.port.ensureStationRun({
      assemblyRunId: id,
      nodeId: "implement",
      iteration: 1,
      agentCrName: `${id.substring(0, 12)}-implement`,
    });
    h.statusByName[`${id.substring(0, 12)}-implement`] = {
      phase: "Succeeded",
      output: JSON.stringify({ type: "result", result: "done" }),
    };
    // Not the file's `params()` helper: that one names the review node.
    await createNodeEventHandler(h.deps)({
      assemblyLineId: id,
      nodeId: "implement",
      agentName: `${id.substring(0, 12)}-implement`,
      taskId: id,
      phase: "Succeeded",
    });

    return { h, id, calls };
  }

  it("records the node failed, naming the empty branch, when zero commits landed", async () => {
    const { h, id, calls } = await implementRun(0);

    expect(calls).toEqual([
      { repo: "o/r", branch: "lore/implementation-loop/x" },
    ]);
    expect(h.port.nodes.find((n) => n.nodeId === "implement")).toMatchObject({
      outcome: "failed",
      failureDetail: expect.stringContaining("pushed nothing"),
    });
    // Retryable: the self-retry edge is exactly the right response to an agent
    // that forgot to push, so the walk re-dispatches implement.
    expect(h.port.nodes.map((n) => `${n.nodeId}:${n.iteration}`)).toEqual([
      "implement:1",
      "implement:2",
    ]);
    void id;
  });

  it("keeps the success when commits landed, and moves on to validate", async () => {
    const { h } = await implementRun(3);

    expect(
      h.port.nodes.map(
        (n) => `${n.nodeId}:${n.iteration}=${n.outcome ?? "open"}`,
      ),
    ).toEqual(["implement:1=success", "validate:1=open"]);
  });

  it("changes nothing when the composition provides no commit count", async () => {
    const { h } = await implementRun(null);

    expect(h.port.nodes[0]).toMatchObject({
      nodeId: "implement",
      outcome: "success",
    });
  });
});
