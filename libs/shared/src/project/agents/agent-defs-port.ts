import type { ResolvedAgentDefinition } from "../../models/agent-definition.js";
// Agent definitions port (configuration side, project.agentDefs — distinct from AgentRunnerPort's execution side, project.agents.run()). project_id=null is the org default, a set project_id is that repo's override; resolution merges project → org → task-types.yaml.

/** The resolved per-task-type config; shape lives with the table in models/agent-definition.ts — this is the merged projection, so no id or timestamps. */
export type AgentDefinition = ResolvedAgentDefinition;

/** A new/updated definition as submitted by the UI/skill (id + timestamps are server-side). */
export type AgentDefinitionInput = Omit<AgentDefinition, "project_id">;

/** A write touching config.pod_resources (the one key the Agents UI owns); merged over the row's config inside the upsert (atomic under the row lock) with inheritedConfig as fallback since config is whole-object across layers. */
export interface PodResourcesWrite {
  podResources: Record<string, unknown> | null;
  inheritedConfig: Record<string, unknown> | null;
}

/** Curated model dropdown for the Agents tab (custom text is still allowed). */
export const KNOWN_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
];

/** The configuration surface of project.agents — read + write agent definitions; read adapters (yaml, http) implement resolve/list and throw on writes. */
export interface AgentDefsPort {
  /** The effective definition for a task type in a repo (project → org → yaml), or null. */
  resolve(repo: string, name: string): Promise<AgentDefinition | null>;
  /** Every effective definition for a repo (org defaults overlaid with project rows). */
  list(repo: string): Promise<AgentDefinition[]>;
  create(repo: string, def: AgentDefinitionInput): Promise<AgentDefinition>;
  update(
    repo: string,
    name: string,
    patch: Partial<AgentDefinitionInput>,
    podResources?: PodResourcesWrite,
  ): Promise<AgentDefinition>;
  delete(repo: string, name: string): Promise<void>;
}

const pick = <T>(...layers: (T | null | undefined)[]): T | null => {
  for (const v of layers) {
    if (v !== null && v !== undefined) {
      return v;
    }
  }

  return null;
};

/** Field-merges the precedence layers (project beats org beats yaml default); a null nullable field means "inherit the next layer down". Returns null only when every layer is absent. */
export function resolveAgentConfig(
  project: AgentDefinition | null,
  org: AgentDefinition | null,
  yamlDefault: AgentDefinition | null,
): AgentDefinition | null {
  const top = project ?? org ?? yamlDefault;

  if (!top) {
    return null;
  }
  // Per FIELD, not per layer: the topmost layer that sets a field wins it, so a project row overriding only the model still inherits the org prompt.
  const layered = <K extends keyof AgentDefinition>(
    field: K,
  ): AgentDefinition[K] | null =>
    pick(project?.[field], org?.[field], yamlDefault?.[field]);

  return {
    name: top.name,
    model: layered("model"),
    timeout_minutes: layered("timeout_minutes"),
    prompt: layered("prompt"),
    image: layered("image"),
    execution_mode: layered("execution_mode") ?? "claude-code",
    review_required: layered("review_required") ?? false,
    project_id: project?.project_id ?? null,
    // Whole-object, not field-merged — a layer that sets config owns all of it, or splicing project skills into org disallowed_tools would produce a recipe nobody wrote.
    config: layered("config"),
  };
}
