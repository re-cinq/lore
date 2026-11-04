// The model the context builder (backend lore-v2) writes with: the org settings page names it, the LORE_CONTEXT_LLM_* env is the fallback, Vertex gemini-3-flash-preview the default, and "off" leaves lore-v2 on the template assembly.

export const CONTEXT_PROVIDER_KEY = "context_llm_provider";
export const CONTEXT_MODEL_KEY = "context_llm_model";

/** What the settings page offers; "off" is stored rather than blank, because a blank org setting means "leave it alone". */
export const CONTEXT_PROVIDERS = ["off", "vertex", "anthropic"] as const;

/** The model a provider gets when the settings name none. */
export const DEFAULT_CONTEXT_PROVIDER = "vertex";

export const DEFAULT_CONTEXT_MODELS: Record<string, string> = {
  vertex: "gemini-3-flash-preview",
  anthropic: "claude-haiku-4-5",
};

export interface ContextModel {
  provider: string;
  model: string;
}

type Named = Record<string, string | undefined>;

/** Never null but for a saved "off". */
export function contextModelOf(
  settings: Named,
  env: Named,
): ContextModel | null {
  const saved = settings[CONTEXT_PROVIDER_KEY];

  if (saved) {
    return saved === "off"
      ? null
      : modelFor(saved, settings[CONTEXT_MODEL_KEY]);
  }
  const named = env.LORE_CONTEXT_LLM_PROVIDER;

  return named
    ? modelFor(named, env.LORE_CONTEXT_LLM_MODEL)
    : modelFor(DEFAULT_CONTEXT_PROVIDER, undefined);
}

function modelFor(provider: string, model: string | undefined): ContextModel {
  return { provider, model: model || (DEFAULT_CONTEXT_MODELS[provider] ?? "") };
}

/** Why an org settings write of `key` = `value` is refused, or null when it is not; a blank value is the form's "leave it alone" and never refused. */
export function contextSettingError(key: string, value: string): string | null {
  const known = (CONTEXT_PROVIDERS as readonly string[]).includes(value);

  return key === CONTEXT_PROVIDER_KEY && value !== "" && !known
    ? `${CONTEXT_PROVIDER_KEY} must be ${CONTEXT_PROVIDERS.slice(0, -1).join(", ")} or ${CONTEXT_PROVIDERS.at(-1)}`
    : null;
}
