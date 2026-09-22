// AgentCrBackend (ADR-031): a StationBackend running a task as an `Agent` CR on the ai-agent-subsystem; K8s IO is behind AgentApi (pure/testable mapping). Async: `launch` omits `completion` — agent-watcher (#684) resolves it later; re-launch of the same task id is idempotent.

import {
  isTerminal,
  type Agent as AgentCr,
  type AgentSpec,
} from "@re-cinq/agent-contracts";
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
import {
  CONTEXT_BOOTSTRAP,
  renderPodPrompt,
} from "../../domain/agents/recipe-prompt.js";

/** How the pod renders the parameters built below; exported beside them so a test can hold the two together. */
export { renderPodPrompt };

/** Maps a LoreTaskSpec to an `Agent` CR body; the recipe (model/prompt/tools) lives on the resolved Station, per-run carries only parameters (incl. the `{context}` fetch-instruction slot). */
export function specToAgent(
  spec: LoreTaskSpec,
  stationRef?: string,
  filesUrl?: string,
): AgentCr {
  return {
    metadata: agentMetadata(spec),
    spec: {
      stationRef: resolveStationRef(spec, stationRef),
      taskId: spec.taskId,
      targetRepo: spec.targetRepo,
      branch: spec.branch,
      parameters: agentParameters(spec),
      ...inputFiles(spec, filesUrl),
    },
  };
}

function agentMetadata(spec: LoreTaskSpec): AgentCr["metadata"] {
  return {
    name: spec.name || agentCrName(spec.taskId),
    labels: {
      [TASK_ID_LABEL]: spec.taskId,
      [TASK_TYPE_LABEL]: spec.taskType,
      ...spec.extraLabels,
    },
  };
}

/** The pod's downloads from THIS cluster's agent-files endpoint, with the credential its event sink already uses; a cluster with no endpoint sends none, and never claims a pass that needs one (it offers no `agent-files` tag). */
function inputFiles(
  spec: LoreTaskSpec,
  filesUrl: string | undefined,
): Pick<AgentSpec, "files"> {
  return filesUrl && spec.files?.length
    ? {
        files: spec.files.map(({ path, ref }) => ({
          path,
          url: `${filesUrl}/${ref}`,
          headers_secret: "agent-events-auth",
        })),
      }
    : {};
}

/** Deterministic per-task Agent name, so a re-launch is idempotent (409). */
export function agentCrName(taskId: string): string {
  return `agent-${taskId.substring(0, 8)}`;
}

/** Per-task token Station override (#697) wins; then the spec's explicit Station; else the task type's catalog Station. */
function resolveStationRef(spec: LoreTaskSpec, stationRef?: string): string {
  if (stationRef) {
    return stationRef;
  }

  return spec.stationRef || spec.taskType;
}

/** The Agent CR's parameters: what the AgentDefinition template's placeholders are filled from. `prompt` is the Floor's fully rendered prompt and is what the LLM template renders (`PROMPT_SLOT`); `description` stays for the station and review templates that read it. */
export function agentParameters(spec: LoreTaskSpec): Record<string, string> {
  const prNumber: Record<string, string> =
    spec.prNumber === undefined ? {} : { pr_number: String(spec.prNumber) };

  return {
    description: spec.description,
    // The review recipe's `{pr_number}` used to be filled by the pod from the parameter below; the template now renders `{prompt}` in one pass, so the Floor fills it here, where the parameter is minted.
    prompt: renderPodPrompt(spec.prompt, prNumber),
    // Always present: renderPrompt leaves an unmatched placeholder intact (so typos surface), so omitting this would ship the literal `{context}` token to the model.
    context: CONTEXT_BOOTSTRAP,
    ...spec.parameters,
    ...prNumber,
  };
}

export class AgentCrBackend implements StationBackend {
  constructor(
    private readonly api: AgentApi,
    private readonly tokens?: TokenProvisioner,
    /** This cluster's agent-files endpoint as its pods reach it; unset sends no input files. */
    private readonly filesUrl?: string,
  ) {}

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    const stationRef =
      this.tokens && needsToken(spec) && spec.clone !== false
        ? await this.tokens.provision(spec)
        : undefined;
    const { name, created } = await this.api.create(
      specToAgent(spec, stationRef, this.filesUrl),
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
