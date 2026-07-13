/**
 * Agent DEFINITIONS port — the configuration side, reached via project.agentDefs
 * (distinct from the AgentRunnerPort execution side, project.agents.run()). An
 * agent definition is the per-task-type config (model, prompt, timeout, image)
 * that lives in lore.agent_definitions. A row with project_id = null is the
 * organisation default; a row with a project_id is that repo's override.
 * Resolution merges project → org → task-types.yaml.
 */

export interface AgentDefinition {
  /** Task-type key: general, implementation, review, … */
  name: string;
  /** LLM model id; null inherits the next layer (zero-LLM ingest agents stay null). */
  model: string | null;
  timeout_minutes: number | null;
  /** Full prompt template; null inherits the next layer. */
  prompt: string | null;
  /** BYO execution image; null inherits the default runner image. */
  image: string | null;
  /** "claude-code" (default, LLM) or "graph-ingest" (deterministic, zero-LLM). */
  execution_mode: string;
  review_required: boolean;
  /** Owning repo (lore.repos.id); null = organisation default. */
  project_id: string | null;
}

/** A new/updated definition as submitted by the UI/skill (id + timestamps are server-side). */
export type AgentDefinitionInput = Omit<AgentDefinition, "project_id">;

/** Curated model dropdown for the Agents tab (custom text is still allowed). */
export const KNOWN_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
];

/**
 * The configuration surface of project.agents — read + write agent definitions.
 * Read adapters (yaml, http) implement resolve/list and throw on writes.
 */
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
  ): Promise<AgentDefinition>;
  delete(repo: string, name: string): Promise<void>;
}

const pick = <T>(...layers: (T | null | undefined)[]): T | null => {
  for (const v of layers) if (v !== null && v !== undefined) return v;
  return null;
};

/**
 * Field-merge the precedence layers: a project row's set field beats the org
 * row, which beats the task-types.yaml default. A null nullable field on a layer
 * means "inherit the next layer down". Returns null only when every layer is
 * absent.
 */
export function resolveAgentConfig(
  project: AgentDefinition | null,
  org: AgentDefinition | null,
  yamlDefault: AgentDefinition | null,
): AgentDefinition | null {
  const top = project ?? org ?? yamlDefault;
  if (!top) return null;

  return {
    name: top.name,
    model: pick(project?.model, org?.model, yamlDefault?.model),
    timeout_minutes: pick(
      project?.timeout_minutes,
      org?.timeout_minutes,
      yamlDefault?.timeout_minutes,
    ),
    prompt: pick(project?.prompt, org?.prompt, yamlDefault?.prompt),
    image: pick(project?.image, org?.image, yamlDefault?.image),
    execution_mode:
      pick(
        project?.execution_mode,
        org?.execution_mode,
        yamlDefault?.execution_mode,
      ) ?? "claude-code",
    review_required:
      pick(
        project?.review_required,
        org?.review_required,
        yamlDefault?.review_required,
      ) ?? false,
    project_id: project?.project_id ?? null,
  };
}
