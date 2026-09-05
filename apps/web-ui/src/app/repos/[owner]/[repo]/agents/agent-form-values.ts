import { KNOWN_MODELS, type AgentDefinition } from "@/lib/agents-mirror";
import { type PodResources } from "@/lib/agents-form";

const KNOWN_IDS = KNOWN_MODELS.map((m) => m.id);

export function scopeNote(orgScope: boolean, inherited: boolean): string {
  if (orgScope) {
    return "This is the organisation default. Saving updates it for every repo without its own override.";
  }

  if (inherited) {
    return "These values are inherited from the organisation default. Saving creates a project agent for this repo; later edits update it.";
  }

  return "This is a project agent for this repo, overriding the organisation default.";
}

function resolveStartCustom(agent: AgentDefinition | null): boolean {
  return !!agent?.model && !KNOWN_IDS.includes(agent.model);
}

function resolveNameAndMode(agent: AgentDefinition | null) {
  return {
    name: agent?.name ?? "",
    executionMode: agent?.execution_mode ?? "claude-code",
  };
}

function resolveReviewAndTimeout(agent: AgentDefinition | null) {
  return {
    reviewRequired: agent?.review_required ? "1" : "0",
    timeoutMinutes: agent?.timeout_minutes ?? "",
  };
}

function resolvePrompt(agent: AgentDefinition | null, isNew: boolean): string {
  return isNew ? "" : (agent?.prompt ?? "");
}

function resolvePromptPlaceholder(agent: AgentDefinition | null): string {
  return agent?.prompt ?? "(inherit base prompt)";
}

function resolveCustomModel(
  agent: AgentDefinition | null,
  startCustom: boolean,
): string {
  return startCustom ? (agent?.model ?? "") : "";
}

function resolveInitialSelection(
  agent: AgentDefinition | null,
  startCustom: boolean,
): string {
  return startCustom ? "__custom__" : (agent?.model ?? "");
}

/** An org row carries no project_id; editing one forks a project agent rather than changing the org default in place. */
function resolveInherited(
  isNew: boolean,
  agent: AgentDefinition | null,
): boolean {
  return !isNew && (agent?.project_id == null || agent.project_id === "");
}

function resolvePodResources(agent: AgentDefinition | null): PodResources {
  return ((agent?.config as { pod_resources?: PodResources } | null)
    ?.pod_resources ?? {}) as PodResources;
}

/** Every field's starting value, resolved once. A blank field means "inherit the layer below", so the stored value becomes the PLACEHOLDER and the input itself stays empty — prefilling would silently promote an inherited value into an override on the next save. */
export function agentFormValues(agent: AgentDefinition | null, isNew: boolean) {
  const startCustom = resolveStartCustom(agent);
  const { name, executionMode } = resolveNameAndMode(agent);
  const { reviewRequired, timeoutMinutes } = resolveReviewAndTimeout(agent);

  return {
    name,
    executionMode,
    reviewRequired,
    timeoutMinutes,
    prompt: resolvePrompt(agent, isNew),
    promptPlaceholder: resolvePromptPlaceholder(agent),
    startCustom,
    customModel: resolveCustomModel(agent, startCustom),
    initialSelection: resolveInitialSelection(agent, startCustom),
    inherited: resolveInherited(isNew, agent),
    podResources: resolvePodResources(agent),
  };
}
