// web-ui is not a workspace member and can't import @re-cinq/lore-shared, so the
// agent display type + curated model list are mirrored here. Keep in sync with
// libs/shared/src/project/agents/agent-defs-port.ts.

export interface AgentDefinition {
  name: string;
  model: string | null;
  timeout_minutes: number | null;
  prompt: string | null;
  image: string | null;
  execution_mode: string;
  review_required: boolean;
  /** null when resolved from the org default / yaml (inherited); set = repo override. */
  project_id: string | null;
}

export const KNOWN_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
];
