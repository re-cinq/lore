import { describe, it, expect } from "vitest";
import { handleClaim } from "./claim.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";

const TOKEN = "lca_minikube_secret";

async function registeredAgent(tags: string[] = ["node:agent"]) {
  const agents = new InMemoryClusterAgents();
  const agent = await agents.create({
    name: "minikube",
    tags,
    tokenHash: hashAgentToken(TOKEN),
    clusterInfo: null,
  });

  enforceTrue(agent, Error, "name already registered");

  return { agents, agent };
}

async function armedQueuedRun(requiredTags: string[] = ["node:agent"]) {
  const runs = new InMemoryAssemblyRuns();
  const assemblyRunId = await runs.start({
    blueprintName: "implementation",
    repo: "re-cinq/lore",
    branch: "lore/task-1",
  });
  const { nodeRowId, stationRunId } = await runs.ensureStationRun({
    assemblyRunId,
    nodeId: "implement",
    iteration: 0,
    agentCrName: "abc123def456-implement",
    status: "queued",
    requiredTags,
  });

  await runs.enqueueStationRunDispatch(nodeRowId, {
    type: "implementation",
    repo: "re-cinq/lore",
    branch: "lore/task-1",
  });

  return { runs, assemblyRunId, nodeRowId, stationRunId };
}

describe("handleClaim", () => {
  it("rejects 401 without a bearer token", async () => {
    const { agents, agent } = await registeredAgent();
    const { runs } = await armedQueuedRun();

    expect(await handleClaim({ agents, runs }, undefined, agent.id)).toEqual({
      code: 401,
      body: { error: "unauthorized" },
    });
  });

  it("rejects 403 on a token no registered agent holds", async () => {
    const { agents, agent } = await registeredAgent();
    const { runs } = await armedQueuedRun();

    expect(await handleClaim({ agents, runs }, "lca_stolen", agent.id)).toEqual(
      { code: 403, body: { error: "forbidden" } },
    );
  });

  it("rejects 403 when a valid token claims against another agent's id", async () => {
    const { agents } = await registeredAgent();
    const { runs } = await armedQueuedRun();

    expect(
      await handleClaim({ agents, runs }, TOKEN, "some-other-agent-id"),
    ).toEqual({ code: 403, body: { error: "forbidden" } });
  });

  it("returns 204 when nothing is queued", async () => {
    const { agents, agent } = await registeredAgent();

    expect(
      await handleClaim(
        { agents, runs: new InMemoryAssemblyRuns() },
        TOKEN,
        agent.id,
      ),
    ).toEqual({ code: 204 });
  });

  it("returns 200 with the queued visit's identity + spec, and a second claim returns 204", async () => {
    const { agents, agent } = await registeredAgent();
    const { runs, assemblyRunId, nodeRowId, stationRunId } =
      await armedQueuedRun();

    expect(await handleClaim({ agents, runs }, TOKEN, agent.id)).toEqual({
      code: 200,
      body: {
        station_run_id: stationRunId,
        node_row_id: nodeRowId,
        assembly_run_id: assemblyRunId,
        node_id: "implement",
        iteration: 0,
        agent_cr_name: "abc123def456-implement",
        spec: {
          type: "implementation",
          repo: "re-cinq/lore",
          branch: "lore/task-1",
        },
      },
    });
    expect(await handleClaim({ agents, runs }, TOKEN, agent.id)).toEqual({
      code: 204,
    });
  });

  it("returns 204 when the agent lacks a required tag", async () => {
    const { agents, agent } = await registeredAgent(["node:agent"]);
    const { runs } = await armedQueuedRun(["node:agent", "gpu"]);

    expect(await handleClaim({ agents, runs }, TOKEN, agent.id)).toEqual({
      code: 204,
    });
  });
});
