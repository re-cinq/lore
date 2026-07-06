import { describe, it, expect } from "vitest";
import type { AssemblyLineNode } from "./loader.js";
import type { NodeContext } from "./assembly-line-executor.js";
import {
  parseNodeResult,
  stationNodeOutcome,
  createStationNodeHandler,
  type AgentNodeStatus,
  type AgentNodeDeps,
} from "./station-node-handler.js";

const detectNode: AssemblyLineNode = { id: "detect", type: "detect", job_ref: "spec_drift" };
const ctx: NodeContext = {
  taskId: "task-1",
  assemblyLineId: "al-test-1",
  branchName: "detect/spec-drift/re-cinq/lore",
  gitDir: "/work",
  iteration: 0,
  assemblyLineName: "spec-drift",
};

const resultLine = (payload: unknown) => `some log\nLORE_NODE_RESULT: ${JSON.stringify(payload)}`;

describe("parseNodeResult", () => {
  it("reads outcome and extras from the LORE_NODE_RESULT line", () => {
    expect(
      parseNodeResult(resultLine({ outcome: "success", extras: { "Lore-Detect-Summary": "3 specs ok" } })),
    ).toEqual({ outcome: "success", extras: { "Lore-Detect-Summary": "3 specs ok" } });
  });

  it("accepts a failed outcome as a normal result", () => {
    expect(parseNodeResult(resultLine({ outcome: "failed" }))).toEqual({ outcome: "failed", extras: {} });
  });

  it("is null on absent, malformed, or unknown-outcome payloads", () => {
    expect(parseNodeResult(undefined)).toBeNull();
    expect(parseNodeResult("just logs, no result line")).toBeNull();
    expect(parseNodeResult("LORE_NODE_RESULT: {not json}")).toBeNull();
    expect(parseNodeResult(resultLine({ outcome: "exploded" }))).toBeNull();
  });

  it("drops non-string extras values", () => {
    expect(parseNodeResult(resultLine({ outcome: "success", extras: { ok: "yes", n: 7 } }))).toEqual({
      outcome: "success",
      extras: { ok: "yes" },
    });
  });
});

describe("stationNodeOutcome", () => {
  it("uses the LORE_NODE_RESULT line on Succeeded", () => {
    const status: AgentNodeStatus = {
      phase: "Succeeded",
      output: resultLine({ outcome: "failed", extras: { "Lore-Validation-Failed": "lint" } }),
    };
    expect(stationNodeOutcome(detectNode, status)).toEqual({
      outcome: "failed",
      extras: { "Lore-Validation-Failed": "lint" },
    });
  });

  it("falls back to the review verdict, then success", () => {
    const agentNode: AssemblyLineNode = { id: "review", type: "agent" };
    expect(
      stationNodeOutcome(agentNode, { phase: "Succeeded", output: "REVIEW_RESULT:CHANGES_REQUESTED" }).outcome,
    ).toBe("changes_requested");
    expect(stationNodeOutcome(detectNode, { phase: "Succeeded", output: "no result line" }).outcome).toBe(
      "success",
    );
  });

  it("maps Failed to station-failed for non-agent nodes and agent-failed for agent nodes", () => {
    expect(stationNodeOutcome(detectNode, { phase: "Failed", failureReason: "deadline" })).toEqual({
      outcome: "failed",
      extras: {
        "Lore-Validation-Status": "station-failed",
        "Lore-Validation-Summary": "deadline",
      },
    });
    expect(
      stationNodeOutcome({ id: "implement", type: "agent" }, { phase: "Failed" }).extras?.[
        "Lore-Validation-Status"
      ],
    ).toBe("agent-failed");
  });
});

function fakeDeps(pollQueue: Array<AgentNodeStatus | null>, over: Partial<AgentNodeDeps> = {}) {
  const calls = { launch: 0, heartbeat: [] as string[], sleep: 0 };
  const queue = [...pollQueue];
  const deps: AgentNodeDeps = {
    launch: async () => void calls.launch++,
    poll: async () => (queue.length ? queue.shift()! : null),
    heartbeat: async (_b, nodeId) => void calls.heartbeat.push(nodeId),
    sleep: async () => void calls.sleep++,
    ...over,
  };
  return { deps, calls };
}

describe("createStationNodeHandler", () => {
  it("launches once and returns the parsed station result", async () => {
    const { deps, calls } = fakeDeps([
      { phase: "Running" },
      { phase: "Succeeded", output: resultLine({ outcome: "success", extras: { "Lore-Detect-Summary": "ok" } }) },
    ]);
    expect(await createStationNodeHandler(deps)(detectNode, ctx)).toEqual({
      outcome: "success",
      extras: { "Lore-Detect-Summary": "ok" },
    });
    expect(calls.launch).toBe(1);
    expect(calls.heartbeat).toEqual(["detect", "detect"]);
  });

  it("times out to failed with station-timeout for non-agent nodes", async () => {
    const { deps } = fakeDeps([{ phase: "Running" }], { maxPolls: 2, pollIntervalMs: 1 });
    expect(await createStationNodeHandler(deps)(detectNode, ctx)).toMatchObject({
      outcome: "failed",
      extras: { "Lore-Validation-Status": "station-timeout" },
    });
  });

  it("node timeout_minutes overrides maxPolls (timeout + 2min buffer at the poll interval)", async () => {
    // 1 minute timeout + 2 min buffer at 60s polls = 3 polls, then timeout.
    const { deps, calls } = fakeDeps([], { maxPolls: 999, pollIntervalMs: 60_000, sleep: async () => {} });
    const timedNode: AssemblyLineNode = { ...detectNode, timeout_minutes: 1 };
    const result = await createStationNodeHandler(deps)(timedNode, ctx);
    expect(result.extras?.["Lore-Validation-Status"]).toBe("station-timeout");
    expect(calls.heartbeat).toHaveLength(3);
  });
});
