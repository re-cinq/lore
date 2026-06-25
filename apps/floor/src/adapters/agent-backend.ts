// AgentBackend (ADR-031): a StationBackend that runs a task as an `Agent` custom
// resource on the ai-agent-subsystem (agents.re-cinq.com) instead of a LoreTask.
// The Kubernetes IO is behind the AgentApi port so the mapping + isActive logic is
// pure and deterministically testable; KubeAgentApi is the live implementation.
//
// Async backend (like K8sLoreTaskClient): `launch` returns once the CR exists and
// OMITS `completion` — the Floor-side agent-watcher (#684) resolves completion from
// the Agent status later. A re-launch of the same task id is idempotent (the CR
// already exists → launched:false).

import { isTerminal, type Agent } from "@re-cinq/agent-contracts";
import type { LoreTaskSpec, StationBackend, StationLaunchResult } from "@re-cinq/lore-shared";

export const TASK_ID_LABEL = "lore.re-cinq.com/task-id";
export const TASK_TYPE_LABEL = "lore.re-cinq.com/task-type";

/** Kubernetes operations on `Agent` CRs, returning structured results (no throw on
 *  409). The live implementation is KubeAgentApi; tests use an in-memory fake. */
export interface AgentApi {
  /** Create the Agent; `created:false` when it already exists (409). */
  create(agent: Agent): Promise<{ name: string; created: boolean }>;
  /** Agents matching a Kubernetes label selector. */
  listByLabel(selector: string): Promise<Agent[]>;
}

/** Deterministic per-task Agent name, so a re-launch is idempotent (409). */
export function agentName(taskId: string): string {
  return `agent-${taskId.substring(0, 8)}`;
}

/** Assembles the Lore context injected into a run's parameters at dispatch (ADR-031
 *  D5), so the agent starts warm instead of spending turn 1 fetching it. The live
 *  implementation calls the context-assembly API; tests use a fake. */
export interface ContextSource {
  assemble(spec: LoreTaskSpec): Promise<string | undefined>;
}

/** Map a LoreTaskSpec to an `Agent` CR body. The recipe (model/prompt/tools) lives
 *  on the Station the task type resolves to; per-run carries only parameters —
 *  including the assembled `context` the recipe's `{context}` placeholder fills (D5). */
export function specToAgent(spec: LoreTaskSpec, context?: string): Agent {
  const parameters: Record<string, string> = {
    description: spec.description,
    prompt: spec.prompt,
  };
  if (spec.prNumber !== undefined) parameters.pr_number = String(spec.prNumber);
  if (context) parameters.context = context;

  return {
    metadata: {
      name: spec.name ?? agentName(spec.taskId),
      labels: {
        [TASK_ID_LABEL]: spec.taskId,
        [TASK_TYPE_LABEL]: spec.taskType,
        ...(spec.extraLabels ?? {}),
      },
    },
    spec: {
      // One Station per task type (the catalog, #685); the run references it by name.
      stationRef: spec.taskType,
      taskId: spec.taskId,
      targetRepo: spec.targetRepo,
      branch: spec.branch,
      parameters,
    },
  };
}

export class AgentBackend implements StationBackend {
  constructor(
    private readonly api: AgentApi,
    private readonly context?: ContextSource,
  ) {}

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    const context = await this.context?.assemble(spec);
    const { name, created } = await this.api.create(specToAgent(spec, context));
    return { ref: name, launched: created };
  }

  /** True while an Agent for `taskId` exists and is not yet terminal. No Agents →
   *  not active (orphaned). A probe failure returns `true` so the reaper falls back
   *  to its age window rather than killing a live run on a transient kube fault. */
  async isActive(taskId: string): Promise<boolean> {
    try {
      const agents = await this.api.listByLabel(`${TASK_ID_LABEL}=${taskId}`);
      if (agents.length === 0) return false;
      return agents.some((agent) => !isTerminal(agent));
    } catch {
      return true;
    }
  }
}
