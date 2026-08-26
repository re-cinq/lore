import { describe, it, expect } from "vitest";
import { handleClusterAgentList } from "./list.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";

async function registeredAgent(agents: InMemoryClusterAgents, name: string) {
  return agents.create({
    name,
    tags: ["node:agent"],
    tokenHash: `hash-${name}`,
    clusterInfo: null,
  });
}

async function claimedRun(runs: InMemoryAssemblyRuns, clusterAgentId: string) {
  const assemblyRunId = await runs.start({
    blueprintName: "implementation",
    repo: "re-cinq/lore",
    branch: `lore/task-${clusterAgentId}`,
  });
  const { nodeRowId } = await runs.ensureStationRun({
    assemblyRunId,
    nodeId: "implement",
    iteration: 0,
    agentCrName: "abc123def456-implement",
    status: "queued",
    requiredTags: ["node:agent"],
  });

  await runs.enqueueStationRunDispatch(nodeRowId, { type: "implementation" });
  await runs.claimNextStationRun({ clusterAgentId, tags: ["node:agent"] });
}

describe("handleClusterAgentList", () => {
  it("returns empty agents and offline_events on an empty registry", async () => {
    expect(
      await handleClusterAgentList({
        agents: new InMemoryClusterAgents(),
        runs: new InMemoryAssemblyRuns(),
        audit: new InMemoryAudit(),
      }),
    ).toEqual({ agents: [], offline_events: [] });
  });

  it("lists minikube with 2 running claims and eu-west4 with 0", async () => {
    const agents = new InMemoryClusterAgents();
    const runs = new InMemoryAssemblyRuns();
    const busy = await registeredAgent(agents, "minikube");
    const idle = await registeredAgent(agents, "eu-west4");

    await claimedRun(runs, busy.id);
    await claimedRun(runs, busy.id);

    const body = await handleClusterAgentList({
      agents,
      runs,
      audit: new InMemoryAudit(),
    });

    expect(body.agents).toEqual([
      {
        id: idle.id,
        name: "eu-west4",
        tags: ["node:agent"],
        status: "active",
        last_seen_at: idle.lastSeenAt.toISOString(),
        running_claims: 0,
      },
      {
        id: busy.id,
        name: "minikube",
        tags: ["node:agent"],
        status: "active",
        last_seen_at: busy.lastSeenAt.toISOString(),
        running_claims: 2,
      },
    ]);
  });

  it("surfaces cluster_agent_offline entries newest-first with payload fields", async () => {
    let tick = 0;
    const audit = new InMemoryAudit(() => new Date(1000 * ++tick));

    await audit.write({
      event_type: "cluster_agent_offline",
      payload: {
        cluster_agent_id: "agent-old",
        station_run_id: "sr-1",
        assembly_run_id: "ar-1",
        node_id: "implement",
        elapsed_since_claim_ms: 60000,
      },
    });
    await audit.write({
      event_type: "cluster_agent_offline",
      payload: {
        cluster_agent_id: "agent-new",
        station_run_id: "sr-2",
        assembly_run_id: "ar-2",
        node_id: "review",
        elapsed_since_claim_ms: null,
      },
    });

    const body = await handleClusterAgentList({
      agents: new InMemoryClusterAgents(),
      runs: new InMemoryAssemblyRuns(),
      audit,
    });

    expect(body.offline_events).toEqual([
      {
        created_at: new Date(2000).toISOString(),
        cluster_agent_id: "agent-new",
        station_run_id: "sr-2",
        assembly_run_id: "ar-2",
        node_id: "review",
        elapsed_since_claim_ms: null,
      },
      {
        created_at: new Date(1000).toISOString(),
        cluster_agent_id: "agent-old",
        station_run_id: "sr-1",
        assembly_run_id: "ar-1",
        node_id: "implement",
        elapsed_since_claim_ms: 60000,
      },
    ]);
  });
});
