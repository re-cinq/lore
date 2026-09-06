import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { specToAgent } from "@re-cinq/lore-shared/cluster/agent-backend.js";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import {
  ASSEMBLY_RUN_ID_LABEL,
  NODE_ID_LABEL,
  NODE_ITERATION_LABEL,
} from "@re-cinq/lore-shared/project/events/agent-cr-labels.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { AgentCrStationBackend } from "./agent-cr-station-backend.js";
import { agentTerminalReport } from "../lib/agent-watcher-logic.js";

const TASK_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const CENTRAL_TAGS = [
  "node:agent",
  "node:validate",
  "node:gate",
  "node:retrospective",
  "node:github_action",
  "node:detect",
  "node:ingest",
];

const spec = (taskType: string): LoreTaskSpec => ({
  taskId: TASK_ID,
  taskType,
  description: "draft the incident runbook",
  prompt: "You are drafting a runbook.",
  targetRepo: "re-cinq/lore",
  branch: "lore/runbook/acceptance",
});

function harness(settings: Record<string, unknown> | null = null) {
  const runs = new InMemoryAssemblyRuns();
  const backend = new AgentCrStationBackend({
    assemblyLine: {
      launch: async () => ({ ref: "assembly-line", launched: true }),
      isActive: async () => true,
    },
    assemblyLineNames: new Set(["implementation", "general", "gap-fill"]),
    assemblyRuns: runs,
    agents: { listByLabel: async () => [] },
    repoSettings: async () => settings,
  });

  return { runs, backend };
}

function runInClaimingCluster(
  claimedSpec: LoreTaskSpec,
  status: { phase: string; output?: string; failureReason?: string },
) {
  const cr = specToAgent(claimedSpec) as AgentCr;

  return {
    cr,
    event: mapAgentToEvent({ ...cr, status } as never),
  };
}

describe("a single-CR task's dispatch, end to end without a cluster (Floor launch → lore-api claim → cluster-agent CR → terminal event → Floor report — the boundaries behind the 2026-08-24 token outage and the 595d2b0b lost report)", () => {
  it("reaches the Floor's terminal report carrying the task it started from", async () => {
    const { runs, backend } = harness();

    const launched = await backend.launch(spec("runbook"));
    const claimed = await runs.claimNextStationRun({
      clusterAgentId: "central",
      tags: CENTRAL_TAGS,
    });

    expect(claimed).not.toBeNull();
    const { event } = runInClaimingCluster(
      claimed!.dispatchSpec as LoreTaskSpec,
      {
        phase: "Succeeded",
        output: "runbook written",
      },
    );

    expect(event).not.toBeNull();
    const report = agentTerminalReport(
      event!.params as Record<string, unknown>,
    );

    expect(report).toEqual({
      taskId: TASK_ID,
      agentName: launched.ref,
      phase: "Succeeded",
      output: "runbook written",
      failureReason: undefined,
    });
  });

  it("routes to kubernetes.agent.*, while a node CR of the same task routes to agent_node.* — the invariant licensing the watcher's deleted assembly-run-label guard (else a node CR would open a PR per node)", async () => {
    const { runs, backend } = harness();

    await backend.launch(spec("runbook"));
    const claimed = await runs.claimNextStationRun({
      clusterAgentId: "central",
      tags: CENTRAL_TAGS,
    });
    const { event } = runInClaimingCluster(
      claimed!.dispatchSpec as LoreTaskSpec,
      { phase: "Succeeded" },
    );

    expect(event?.eventName).toBe("kubernetes.agent.succeeded");
    expect(event?.dedupeKey).toContain(TASK_ID);

    const nodeCr = specToAgent({
      ...spec("runbook"),
      extraLabels: {
        [ASSEMBLY_RUN_ID_LABEL]: "run-1",
        [NODE_ID_LABEL]: "implement",
        [NODE_ITERATION_LABEL]: "1",
      },
    }) as AgentCr;
    const nodeEvent = mapAgentToEvent({
      ...nodeCr,
      status: { phase: "Succeeded" },
    } as never);

    expect(nodeEvent?.eventName).toBe("kubernetes.agent_node.succeeded");
  });

  it("names the CR the same value in the row, the spec, the CR and the event — four copies compared only implicitly, so a spelling drift would never correlate rather than fail to compile", async () => {
    const { runs, backend } = harness();

    const launched = await backend.launch(spec("runbook"));
    const claimed = await runs.claimNextStationRun({
      clusterAgentId: "central",
      tags: CENTRAL_TAGS,
    });
    const { cr, event } = runInClaimingCluster(
      claimed!.dispatchSpec as LoreTaskSpec,
      { phase: "Succeeded" },
    );

    expect(claimed!.agentCrName).toBe(launched.ref);
    expect(cr.metadata?.name).toBe(launched.ref);
    expect((event!.params as { agentName: string }).agentName).toBe(
      launched.ref,
    );
  });

  it("carries a Failed phase's reason through to the report the Floor settles from", async () => {
    const { runs, backend } = harness();

    await backend.launch(spec("runbook"));
    const claimed = await runs.claimNextStationRun({
      clusterAgentId: "central",
      tags: CENTRAL_TAGS,
    });
    const { event } = runInClaimingCluster(
      claimed!.dispatchSpec as LoreTaskSpec,
      {
        phase: "Failed",
        failureReason: "BackoffLimitExceeded",
      },
    );

    expect(
      agentTerminalReport(event!.params as Record<string, unknown>),
    ).toMatchObject({
      phase: "Failed",
      failureReason: "BackoffLimitExceeded",
    });
  });
});

describe("which cluster may take a single-CR task", () => {
  it("is claimable by a satellite carrying only node:agent, unlike the old push path which could only ever execute centrally", async () => {
    const { runs, backend } = harness();

    await backend.launch(spec("runbook"));

    expect(
      await runs.claimNextStationRun({
        clusterAgentId: "gpu-box-1",
        tags: ["node:agent"],
      }),
    ).toMatchObject({ nodeId: "agent" });
  });

  it("is not claimable by a cluster without the node type's tag", async () => {
    const { runs, backend } = harness();

    await backend.launch(spec("runbook"));

    expect(
      await runs.claimNextStationRun({
        clusterAgentId: "detect-only",
        tags: ["node:detect"],
      }),
    ).toBeNull();
  });

  it("honours a repo pinning its work to a tagged cluster", async () => {
    const { runs, backend } = harness({ station_default_tags: ["gpu"] });

    await backend.launch(spec("runbook"));

    expect(
      await runs.claimNextStationRun({
        clusterAgentId: "central",
        tags: CENTRAL_TAGS,
      }),
    ).toBeNull();
    expect(
      await runs.claimNextStationRun({
        clusterAgentId: "gpu-box-1",
        tags: ["node:agent", "gpu"],
      }),
    ).toMatchObject({ nodeId: "agent" });
  });

  it("hands the same visit to only one of two racing clusters", async () => {
    const { runs, backend } = harness();

    await backend.launch(spec("runbook"));
    const first = await runs.claimNextStationRun({
      clusterAgentId: "cluster-a",
      tags: ["node:agent"],
    });
    const second = await runs.claimNextStationRun({
      clusterAgentId: "cluster-b",
      tags: ["node:agent"],
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
