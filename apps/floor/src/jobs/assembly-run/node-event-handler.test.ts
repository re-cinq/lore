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
  };

  return {
    port,
    launched,
    statusByName,
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
