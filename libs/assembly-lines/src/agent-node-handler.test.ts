import { describe, it, expect } from "vitest";
import type { AssemblyLineNode } from "./loader.js";
import type { NodeContext } from "./assembly-line-executor.js";
import {
  parseReviewVerdict,
  agentNodeOutcome,
  createAgentNodeHandler,
  type AgentNodeStatus,
  type AgentNodeDeps,
} from "./agent-node-handler.js";

const node: AssemblyLineNode = { id: "implement", type: "agent" };
const ctx: NodeContext = {
  taskId: "task-1",
  assemblyLineId: "al-test-1",
  branchName: "lore/impl-1",
  gitDir: "/work",
  iteration: 0,
  assemblyLineName: "implementation",
};

describe("parseReviewVerdict", () => {
  it("reads the REVIEW_RESULT line", () => {
    expect(parseReviewVerdict("blah\nREVIEW_RESULT: CHANGES_REQUESTED fix x")).toBe("changes_requested");
    expect(parseReviewVerdict("REVIEW_RESULT:APPROVED")).toBe("success");
  });
  it("is null without a verdict line or output", () => {
    expect(parseReviewVerdict("just some output")).toBeNull();
    expect(parseReviewVerdict(undefined)).toBeNull();
  });
});

describe("agentNodeOutcome", () => {
  it("maps Failed to failed with the reason (or a default)", () => {
    expect(agentNodeOutcome({ phase: "Failed", failureReason: "boom" })).toMatchObject({
      outcome: "failed",
      extras: { "Lore-Validation-Summary": "boom" },
    });
    expect(agentNodeOutcome({ phase: "Failed" }).extras?.["Lore-Validation-Summary"]).toBe("agent run failed");
  });
  it("maps a review verdict, else success", () => {
    expect(agentNodeOutcome({ phase: "Succeeded", output: "REVIEW_RESULT:CHANGES_REQUESTED" }).outcome).toBe("changes_requested");
    expect(agentNodeOutcome({ phase: "Succeeded", output: "REVIEW_RESULT:APPROVED" }).outcome).toBe("success");
    expect(agentNodeOutcome({ phase: "Succeeded" }).outcome).toBe("success");
  });
});

// Records every port call; replays a queued sequence of poll results.
function fakeDeps(pollQueue: Array<AgentNodeStatus | null>, over: Partial<AgentNodeDeps> = {}) {
  const calls = { launch: 0, heartbeat: [] as string[], sleep: 0, poll: [] as string[] };
  const queue = [...pollQueue];
  const deps: AgentNodeDeps = {
    launch: async () => { calls.launch++; },
    poll: async (assemblyLineId, nodeId) => { calls.poll.push(`${assemblyLineId}/${nodeId}`); return queue.length ? queue.shift()! : null; },
    heartbeat: async (_b, nodeId) => { calls.heartbeat.push(nodeId); },
    sleep: async () => { calls.sleep++; },
    ...over,
  };
  return { deps, calls };
}

describe("createAgentNodeHandler", () => {
  it("launches once, heartbeats each poll, and returns the terminal outcome", async () => {
    const { deps, calls } = fakeDeps([{ phase: "Running" }, { phase: "Succeeded" }]);
    expect(await createAgentNodeHandler(deps)(node, ctx)).toEqual({ outcome: "success" });
    expect(calls.launch).toBe(1);
    expect(calls.heartbeat).toEqual(["implement", "implement"]);
    expect(calls.poll).toEqual(["al-test-1/implement", "al-test-1/implement"]); // polls THIS node's Agent, keyed per attempt
    expect(calls.sleep).toBe(1);
  });

  it("treats a not-yet-found status (null) as non-terminal", async () => {
    const { deps } = fakeDeps([null, { phase: "Succeeded", output: "REVIEW_RESULT:CHANGES_REQUESTED" }]);
    expect((await createAgentNodeHandler(deps)(node, ctx)).outcome).toBe("changes_requested");
  });

  it("surfaces a failed agent run", async () => {
    const { deps } = fakeDeps([{ phase: "Failed", failureReason: "oom" }]);
    expect((await createAgentNodeHandler(deps)(node, ctx)).outcome).toBe("failed");
  });

  it("times out to failed after maxPolls without a terminal phase", async () => {
    const { deps, calls } = fakeDeps([{ phase: "Running" }], { maxPolls: 2, pollIntervalMs: 1 });
    const result = await createAgentNodeHandler(deps)(node, ctx);
    expect(result).toMatchObject({ outcome: "failed", extras: { "Lore-Validation-Status": "agent-timeout" } });
    expect(calls.heartbeat).toHaveLength(2);
  });
});
