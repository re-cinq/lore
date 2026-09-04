/** Resolves the active {@link LlmProvider} from env: `LORE_LLM_PROVIDER` over legacy `LORE_FACT_LLM`, defaulting to Anthropic; model from the vendor-appropriate env var. */

import type { LlmProvider } from "./llm-provider.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { CliProvider } from "./cli-provider.js";

function resolveVendor(env: NodeJS.ProcessEnv): string {
  return (env.LORE_LLM_PROVIDER || env.LORE_FACT_LLM || "claude").toLowerCase();
}

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
  openai: (env) =>
    new OpenAiProvider({ model: env.LORE_FACT_MODEL || "gpt-4o-mini" }),
  ollama: (env) =>
    new OllamaProvider({ model: env.LORE_FACT_MODEL || "llama3" }),
  gemini: (env, opts) =>
    new GeminiProvider({
      model: env.LORE_FACT_MODEL || "gemini-2.5-flash",
      apiKey: env.GEMINI_API_KEY,
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
