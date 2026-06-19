import type * as k8s from "@kubernetes/client-node";
import { buildAgentJob } from "./job-builder.js";
import type { Agent, AgentDefinition, AgentPhase, AgentStatus, Station } from "./cr-types.js";

/**
 * The reconcile decision (ADR-031), pure of the k8s client: all IO goes through
 * the injected ReconcileDeps so it can be driven by a hand-rolled fake in tests.
 *
 * Pending  → resolve Station → AgentDefinition → stamp a Job → mark Running.
 * Running  → check the Job → mark Succeeded/Failed, then prune old run records.
 * Terminal → nothing (pruning already happened at the transition).
 */

export type JobOutcome =
  | { state: "running" }
  | { state: "succeeded"; exitCode: number; output?: string }
  | { state: "failed"; exitCode: number; reason: string; output?: string };

export interface ReconcileDeps {
  getStation(name: string): Promise<Station | null>;
  getAgentDefinition(name: string): Promise<AgentDefinition | null>;
  createJob(job: k8s.V1Job): Promise<void>;
  jobOutcome(jobName: string): Promise<JobOutcome | null>;
  patchAgentStatus(name: string, status: AgentStatus): Promise<void>;
  listAgentsForStation(stationName: string): Promise<Agent[]>;
  deleteAgent(name: string): Promise<void>;
  /** Injected so tests are deterministic; the controller passes new Date().toISOString(). */
  now(): string;
}

export async function reconcileAgent(agent: Agent, namespace: string, deps: ReconcileDeps): Promise<void> {
  const name = agent.metadata.name;
  if (!name) return;
  const phase = agent.status?.phase;

  if (!phase || phase === "Pending") {
    const station = await deps.getStation(agent.spec.stationRef);
    if (!station) {
      await deps.patchAgentStatus(name, fail(`Station "${agent.spec.stationRef}" not found`, deps.now()));
      return;
    }
    const def = await deps.getAgentDefinition(station.spec.agentDefRef);
    if (!def) {
      await deps.patchAgentStatus(name, fail(`AgentDefinition "${station.spec.agentDefRef}" not found`, deps.now()));
      return;
    }
    const job = buildAgentJob(agent, station, def, namespace);
    await deps.createJob(job);
    await deps.patchAgentStatus(name, { phase: "Running", jobName: job.metadata?.name, startedAt: deps.now() });
    return;
  }

  if (phase === "Running") {
    const jobName = agent.status?.jobName;
    if (!jobName) return;
    const outcome = await deps.jobOutcome(jobName);
    if (!outcome || outcome.state === "running") return;

    if (outcome.state === "succeeded") {
      await deps.patchAgentStatus(name, {
        phase: "Succeeded",
        exitCode: outcome.exitCode,
        output: outcome.output,
        completedAt: deps.now(),
      });
    } else {
      await deps.patchAgentStatus(name, {
        phase: "Failed",
        exitCode: outcome.exitCode,
        failureReason: outcome.reason,
        output: outcome.output,
        completedAt: deps.now(),
      });
    }
    await pruneHistory(agent.spec.stationRef, deps);
  }
}

function fail(reason: string, now: string): AgentStatus {
  return { phase: "Failed", failureReason: reason, completedAt: now };
}

/** Keep only the Station's history limits of finished Agents; delete the oldest beyond them. */
export async function pruneHistory(stationName: string, deps: ReconcileDeps): Promise<void> {
  const station = await deps.getStation(stationName);
  if (!station) return;
  const agents = await deps.listAgentsForStation(stationName);
  await pruneByPhase(agents, "Succeeded", station.spec.successfulRunsHistoryLimit ?? 3, deps);
  await pruneByPhase(agents, "Failed", station.spec.failedRunsHistoryLimit ?? 3, deps);
}

async function pruneByPhase(agents: Agent[], phase: AgentPhase, limit: number, deps: ReconcileDeps): Promise<void> {
  const finished = agents
    .filter((a) => a.status?.phase === phase)
    .sort((a, b) => (b.status?.completedAt ?? "").localeCompare(a.status?.completedAt ?? "")); // newest first
  for (const stale of finished.slice(limit)) {
    if (stale.metadata.name) await deps.deleteAgent(stale.metadata.name);
  }
}
