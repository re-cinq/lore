import { describe, it, expect } from "vitest";
import { handleComplete } from "./complete.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";

const TOKEN = "lca_minikube_secret";
const OUTPUT = '{"type":"result","result":"REVIEW_RESULT:APPROVED"}';

async function registeredAgent() {
  const agents = new InMemoryClusterAgents();
  const agent = await agents.create({
    name: "minikube",
    tags: ["node:agent"],
    tokenHash: hashAgentToken(TOKEN),
    clusterInfo: null,
  });

  enforceTrue(agent, Error, "name already registered");

  return { agents, agent };
}

async function claimedRun() {
  const runs = new InMemoryAssemblyRuns();
  const assemblyRunId = await runs.start({
    blueprintName: "code-review",
    repo: "re-cinq/lore",
    branch: "lore/task-1",
  });
  const { stationRunId } = await runs.ensureStationRun({
    assemblyRunId,
    nodeId: "review",
    iteration: 1,
    agentCrName: "abc123def456-review",
  });

  return { runs, stationRunId };
}

describe("handleComplete", () => {
  it("rejects 401 without a bearer token", async () => {
    const { agents, agent } = await registeredAgent();
    const { runs, stationRunId } = await claimedRun();

    expect(
      await handleComplete({ agents, runs }, undefined, agent.id, {
        station_run_id: stationRunId,
        output: OUTPUT,
      }),
    ).toEqual({ code: 401, body: { error: "unauthorized" } });
  });

  it("rejects 403 on a token no registered agent holds", async () => {
    const { agents, agent } = await registeredAgent();
    const { runs, stationRunId } = await claimedRun();

    expect(
      await handleComplete({ agents, runs }, "lca_wrong", agent.id, {
        station_run_id: stationRunId,
        output: OUTPUT,
      }),
    ).toEqual({ code: 403, body: { error: "forbidden" } });
  });

  it("rejects 403 when the token belongs to a different agent than the id", async () => {
    const { agents, agent } = await registeredAgent();
    const { runs, stationRunId } = await claimedRun();

    enforceTrue(agent, Error, "registered");

    expect(
      await handleComplete({ agents, runs }, TOKEN, "not-this-agent", {
        station_run_id: stationRunId,
        output: OUTPUT,
      }),
    ).toEqual({ code: 403, body: { error: "forbidden" } });
  });

  it("stores the reported output against the visit and answers 204", async () => {
    const { agents, agent } = await registeredAgent();
    const { runs, stationRunId } = await claimedRun();

    const result = await handleComplete({ agents, runs }, TOKEN, agent.id, {
      station_run_id: stationRunId,
      output: OUTPUT,
    });

    expect(result).toEqual({ code: 204 });
    expect(await runs.readStationRunTerminalOutput(stationRunId)).toBe(OUTPUT);
  });

  it("a paused agent still reports — pausing withholds new work, not results", async () => {
    const { agents, agent } = await registeredAgent();
    const { runs, stationRunId } = await claimedRun();

    await agents.setPaused(agent.id, true);

    expect(
      await handleComplete({ agents, runs }, TOKEN, agent.id, {
        station_run_id: stationRunId,
        output: OUTPUT,
      }),
    ).toEqual({ code: 204 });
    expect(await runs.readStationRunTerminalOutput(stationRunId)).toBe(OUTPUT);
  });

  it("re-reporting the same visit is a no-op, not an append", async () => {
    const { agents, agent } = await registeredAgent();
    const { runs, stationRunId } = await claimedRun();
    const report = { station_run_id: stationRunId, output: OUTPUT };

    await handleComplete({ agents, runs }, TOKEN, agent.id, report);
    await handleComplete({ agents, runs }, TOKEN, agent.id, report);

    expect(await runs.readStationRunTerminalOutput(stationRunId)).toBe(OUTPUT);
  });
});
