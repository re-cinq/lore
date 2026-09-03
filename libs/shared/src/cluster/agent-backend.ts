// AgentCrBackend (ADR-031): a StationBackend running a task as an `Agent` CR on the ai-agent-subsystem; K8s IO is behind AgentApi (pure/testable mapping). Async: `launch` omits `completion` — agent-watcher (#684) resolves it later; re-launch of the same task id is idempotent.

import { isTerminal, type Agent as AgentCr } from "@re-cinq/agent-contracts";
import type { LoreTaskSpec } from "../project/agents/k8s-port.js";
import type {
  StationBackend,
  StationLaunchResult,
} from "../project/agents/station-port.js";
import { needsToken } from "./per-task-token.js";

export const TASK_ID_LABEL = "lore.re-cinq.com/task-id";
export const TASK_TYPE_LABEL = "lore.re-cinq.com/task-type";

/** Kubernetes operations on `Agent` CRs, returning structured results (no throw on 409); live impl is KubeAgentApi, tests use an in-memory fake. */
export type {
  AgentApi,
  AgentLister,
  TokenProvisioner,
} from "./cluster-ports.js";
import type {
  AgentApi,
  AgentLister,
  TokenProvisioner,
} from "./cluster-ports.js";
import { CONTEXT_BOOTSTRAP } from "../agents/recipe-prompt.js";

/** Deterministic per-task Agent name, so a re-launch is idempotent (409). */
export function agentCrName(taskId: string): string {
  return `agent-${taskId.substring(0, 8)}`;
}

/** Provisions a per-task GitHub token (ADR-031 D6, #697) and materializes the per-task AgentDefinition+Station pair; returns the per-task Station name, or undefined to fall back to the catalog Station. */

/** Maps a LoreTaskSpec to an `Agent` CR body; the recipe (model/prompt/tools) lives on the resolved Station, per-run carries only parameters (incl. the `{context}` fetch-instruction slot). */
export function specToAgent(spec: LoreTaskSpec, stationRef?: string): AgentCr {
  const parameters: Record<string, string> = {
    description: spec.description,
    prompt: spec.prompt,
    // Always present: renderPrompt leaves an unmatched placeholder intact (so typos surface), so omitting this would ship the literal `{context}` token to the model.
    context: CONTEXT_BOOTSTRAP,
    ...(spec.parameters ?? {}),
  };

  if (spec.prNumber !== undefined) {
    parameters.pr_number = String(spec.prNumber);
  }

  return {
    metadata: {
      name: spec.name ?? agentCrName(spec.taskId),
      labels: {
        [TASK_ID_LABEL]: spec.taskId,
        [TASK_TYPE_LABEL]: spec.taskType,
        ...(spec.extraLabels ?? {}),
      },
    },
    spec: {
      // Per-task token Station override (#697) wins; then the spec's explicit Station; else the task type's catalog Station.
      stationRef: stationRef ?? spec.stationRef ?? spec.taskType,
      taskId: spec.taskId,
      targetRepo: spec.targetRepo,
      branch: spec.branch,
      parameters,
    },
  };
}

export class AgentCrBackend implements StationBackend {
  constructor(
    private readonly api: AgentApi,
    private readonly tokens?: TokenProvisioner,
  ) {}

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    const stationRef =
      this.tokens && needsToken(spec) && spec.clone !== false
        ? await this.tokens.provision(spec)
        : undefined;
    const { name, created } = await this.api.create(
      specToAgent(spec, stationRef),
    );

    return { ref: name, launched: created };
  }

  isActive(taskId: string): Promise<boolean> {
    return isTaskAgentActive(this.api, taskId);
  }
}

/** True while an Agent for `taskId` exists and is not yet terminal; a probe failure returns `true` so the reaper falls back to its age window rather than killing a live run on a transient kube fault. Free function over {@link AgentLister} since callers should not hold something that can create a CR. */
export async function isTaskAgentActive(
  agents: AgentLister,
  taskId: string,
): Promise<boolean> {
  try {
    const found = await agents.listByLabel(`${TASK_ID_LABEL}=${taskId}`);

    if (found.length === 0) {
      return false;
    }

    return found.some((agent) => !isTerminal(agent));
  } catch {
    return true;
  }
}
