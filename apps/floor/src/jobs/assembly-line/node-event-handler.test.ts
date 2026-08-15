import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  parseAssemblyLine,
  type AssemblyLine,
  type AgentNodeStatus,
} from "@re-cinq/lore-assembly-lines";
import { createNodeEventHandler } from "./node-event-handler.js";

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
  const handler = createNodeEventHandler({
    assemblyLines: port,
    definitions: async () => new Map([["code-review", line]]),
    launch: async (spec) => {
      launched.push(spec);
    },
    resolvePrompt: (ref) => `prompt:${ref}`,
    cleanupToken: async () => {},
    jobRuns: { complete: async () => {}, fail: async () => {} },
    readAgentStatus: async (name) => statusByName[name] ?? null,
    alertBilling: async (repo, nodeType) => {
      billingAlerts.push({ repo, nodeType });
    },
  });

  return { port, launched, statusByName, billingAlerts, handler };
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
