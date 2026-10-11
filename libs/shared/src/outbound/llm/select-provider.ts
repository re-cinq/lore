/** Resolves the active {@link LlmProvider} from env: `LORE_LLM_PROVIDER` over legacy `LORE_FACT_LLM`, defaulting to Anthropic; model from the vendor-appropriate env var. One use can name its own vendor through {@link selectProviderFor}. */

import type { LlmProvider } from "./llm-provider.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { CliProvider } from "./cli-provider.js";
import { VertexProvider } from "./vertex-provider.js";

// No API key → fall back to the `claude` CLI (subscription, zero API spend).
function claudeProvider(
  env: NodeJS.ProcessEnv,
  opts: { usage?: UsagePort },
): LlmProvider {
  if (!env.ANTHROPIC_API_KEY) {
    return new CliProvider();
  }

  return new AnthropicProvider({
    model: env.ANTHROPIC_MODEL,
    usage: opts.usage,
  });
}

type ProviderFactory = (
  env: NodeJS.ProcessEnv,
  opts: { usage?: UsagePort },
) => LlmProvider;

const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  ollama: (env) =>
    new OllamaProvider({ model: env.LORE_FACT_MODEL || "llama3" }),
  gemini: (env, opts) =>
    new GeminiProvider({
      model: env.LORE_FACT_MODEL || "gemini-2.5-flash",
      apiKey: env.GEMINI_API_KEY,
      usage: opts.usage,
    }),
  vertex: (env, opts) =>
    new VertexProvider({
      model: env.LORE_FACT_MODEL || "gemini-2.5-flash",
      usage: opts.usage,
    }),
  cli: () => new CliProvider(),
  claude: claudeProvider,
  anthropic: claudeProvider,
};

export function selectProvider(
  env: NodeJS.ProcessEnv,
  opts: { usage?: UsagePort } = {},
): LlmProvider {
  const vendor = resolveVendor(env);
  const factory = PROVIDER_FACTORIES[vendor] ?? claudeProvider;

  return factory(env, opts);
}

function resolveVendor(env: NodeJS.ProcessEnv): string {
  return (env.LORE_LLM_PROVIDER || env.LORE_FACT_LLM || "claude").toLowerCase();
}

/** The provider one named use asked for: `LORE_<USE>_LLM_PROVIDER` and `LORE_<USE>_LLM_MODEL` win over the process-wide choice, so a use can run on another vendor without moving every other call. */
export function selectProviderFor(
  use: string,
  env: NodeJS.ProcessEnv,
  opts: { usage?: UsagePort } = {},
): LlmProvider {
  return selectProvider(envFor(use, env), opts);
}

/** Whether a use names its own vendor, and so needs its own provider. */
export function useNamesProvider(use: string, env: NodeJS.ProcessEnv): boolean {
  return Boolean(env[`${usePrefix(use)}_PROVIDER`]);
}

function envFor(use: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const vendor = env[`${usePrefix(use)}_PROVIDER`];
  const model = env[`${usePrefix(use)}_MODEL`];

  return {
    ...env,
    ...(vendor ? { LORE_LLM_PROVIDER: vendor } : {}),
    ...(model ? { LORE_FACT_MODEL: model, ANTHROPIC_MODEL: model } : {}),
  };
}

function usePrefix(use: string): string {
  return `LORE_${use.toUpperCase()}_LLM`;
}
