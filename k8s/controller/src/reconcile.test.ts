import { describe, it, expect } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import { reconcileAgent, type ReconcileDeps, type JobOutcome } from "./reconcile.js";
import type { Agent, AgentDefinition, AgentStatus, Station } from "./cr-types.js";

const DEF: AgentDefinition = { metadata: { name: "bug-fixer" }, spec: { prompt: "Fix {t}." } };

function station(over: Partial<Station["spec"]> = {}): Station {
  return {
    metadata: { name: "node-fixer" },
    spec: { agentDefRef: "bug-fixer", template: { spec: { containers: [{ name: "agent", image: "busybox" }] } }, ...over },
  };
}

/** Hand-rolled in-memory cluster — real behavior, no mocking library. */
function fakeDeps(opts: {
  stations?: Record<string, Station>;
  defs?: Record<string, AgentDefinition>;
  agents?: Agent[];
  outcome?: JobOutcome | null;
}) {
  const patched: Record<string, AgentStatus> = {};
  const createdJobs: k8s.V1Job[] = [];
  const deleted: string[] = [];
  const deps: ReconcileDeps = {
    getStation: async (n) => opts.stations?.[n] ?? null,
    getAgentDefinition: async (n) => opts.defs?.[n] ?? null,
    createJob: async (j) => void createdJobs.push(j),
    jobOutcome: async () => opts.outcome ?? null,
    patchAgentStatus: async (n, s) => void (patched[n] = s),
    listAgentsForStation: async () => opts.agents ?? [],
    deleteAgent: async (n) => void deleted.push(n),
    now: () => "2026-06-18T00:00:00.000Z",
  };
  return { deps, patched, createdJobs, deleted };
}

const pendingAgent: Agent = { metadata: { name: "run-1", uid: "u1" }, spec: { stationRef: "node-fixer", parameters: { t: "ENG-1" } } };

describe("reconcileAgent", () => {
  it("creates a Job and marks a Pending agent Running", async () => {
    const f = fakeDeps({ stations: { "node-fixer": station() }, defs: { "bug-fixer": DEF } });

    await reconcileAgent(pendingAgent, "lore-agents", f.deps);

    expect(f.createdJobs).toHaveLength(1);
    expect(f.createdJobs[0].metadata?.name).toBe("agent-job-run-1");
    expect(f.patched["run-1"]).toMatchObject({ phase: "Running", jobName: "agent-job-run-1", startedAt: "2026-06-18T00:00:00.000Z" });
  });

  it("marks the agent Failed when its Station is missing", async () => {
    const f = fakeDeps({ defs: { "bug-fixer": DEF } });

    await reconcileAgent(pendingAgent, "lore-agents", f.deps);

    expect(f.createdJobs).toHaveLength(0);
    expect(f.patched["run-1"]).toMatchObject({ phase: "Failed", failureReason: 'Station "node-fixer" not found' });
  });

  it("marks a Running agent Succeeded when its Job succeeds", async () => {
    const running: Agent = { metadata: { name: "run-1" }, spec: { stationRef: "node-fixer" }, status: { phase: "Running", jobName: "agent-job-run-1" } };
    const f = fakeDeps({ stations: { "node-fixer": station() }, outcome: { state: "succeeded", exitCode: 0, output: "done" } });

    await reconcileAgent(running, "lore-agents", f.deps);

    expect(f.patched["run-1"]).toMatchObject({ phase: "Succeeded", exitCode: 0, output: "done" });
  });

  it("prunes succeeded agents beyond the Station's history limit (newest kept)", async () => {
    const finished = (name: string, completedAt: string): Agent => ({
      metadata: { name }, spec: { stationRef: "node-fixer" }, status: { phase: "Succeeded", completedAt },
    });
    // 4 succeeded; limit 2 → the 2 oldest get deleted.
    const agents = [
      finished("old-1", "2026-06-01T00:00:00Z"),
      finished("old-2", "2026-06-02T00:00:00Z"),
      finished("new-1", "2026-06-03T00:00:00Z"),
      finished("new-2", "2026-06-04T00:00:00Z"),
    ];
    const running: Agent = { metadata: { name: "new-2" }, spec: { stationRef: "node-fixer" }, status: { phase: "Running", jobName: "j" } };
    const f = fakeDeps({
      stations: { "node-fixer": station({ successfulRunsHistoryLimit: 2 }) },
      outcome: { state: "succeeded", exitCode: 0 },
      agents,
    });

    await reconcileAgent(running, "lore-agents", f.deps);

    expect(f.deleted.sort()).toEqual(["old-1", "old-2"]);
  });
});
