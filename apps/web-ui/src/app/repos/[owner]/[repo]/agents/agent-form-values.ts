import { KNOWN_MODELS, type AgentDefinition } from "@/lib/agents-mirror";
import { type PodResources } from "@/lib/agents-form";

const KNOWN_IDS = KNOWN_MODELS.map((m) => m.id);

export function scopeNote(scope: {
  orgScope: boolean;
  inherited: boolean;
}): string {
  if (scope.orgScope) {
    return "This is the organisation default. Saving updates it for every repo without its own override.";
  }

  if (scope.inherited) {
    return "These values are inherited from the organisation default. Saving creates a project agent for this repo; later edits update it.";
  }

  return "This is a project agent for this repo, overriding the organisation default.";
}

/** Every field's starting value, resolved once. A blank field means "inherit the layer below", so the stored value becomes the PLACEHOLDER and the input itself stays empty — prefilling would silently promote an inherited value into an override on the next save. */
export function agentFormValues(
  agent: AgentDefinition | null,
  { isNew }: { isNew: boolean },
) {
  const { name, executionMode } = resolveNameAndMode(agent);
  const { reviewRequired, timeoutMinutes } = resolveReviewAndTimeout(agent);

  return {
    name,
    executionMode,
    reviewRequired,
    timeoutMinutes,
    prompt: isNew ? "" : (agent?.prompt ?? ""),
    promptPlaceholder: resolvePromptPlaceholder(agent),
    ...resolveModelFields(agent),
    inherited: resolveInherited(agent, { isNew }),
    podResources: resolvePodResources(agent),
  };
}

/** A custom model fills the free-text field and selects the custom option; a known one leaves the field empty and selects itself. */
function resolveModelFields(agent: AgentDefinition | null) {
  const model = agent?.model ?? "";
  const startCustom = !!model && !KNOWN_IDS.includes(model);

  return {
    startCustom,
    customModel: startCustom ? model : "",
    initialSelection: startCustom ? "__custom__" : model,
  };
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

function resolvePromptPlaceholder(agent: AgentDefinition | null): string {
  return agent?.prompt ?? "(inherit base prompt)";
}

/** An org row carries no project_id; editing one forks a project agent rather than changing the org default in place. */
function resolveInherited(
  agent: AgentDefinition | null,
  { isNew }: { isNew: boolean },
): boolean {
  return !isNew && (agent?.project_id == null || agent.project_id === "");
}

function resolvePodResources(agent: AgentDefinition | null): PodResources {
  return ((agent?.config as { pod_resources?: PodResources } | null)
    ?.pod_resources ?? {}) as PodResources;
}
