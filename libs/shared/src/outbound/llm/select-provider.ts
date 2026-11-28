/** Resolves the active {@link LlmProvider} from env: `LORE_LLM_PROVIDER` over legacy `LORE_FACT_LLM`, defaulting to Anthropic; model from the vendor-appropriate env var. One use can name its own vendor through {@link selectProviderFor}. */

import type { LlmProvider } from "./llm-provider.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { CliProvider } from "./cli-provider.js";
import { VertexProvider } from "./vertex-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import { openAiAuthHeader } from "../openai/openai-auth.js";
import { enforceTrue } from "../../lib/enforce.js";

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

const PROVIDER_FACTORIES: Partial<Record<string, ProviderFactory>> = {
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
  openai: (env, opts) =>
    new OpenAiProvider({
      model: env.LORE_FACT_MODEL,
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      authHeader: openAiAuthHeader(env),
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
  const factory = PROVIDER_FACTORIES[vendor];

  enforceTrue(
    factory,
    Error,
    `Unknown LLM provider ${vendor}; known: ${Object.keys(PROVIDER_FACTORIES).join(", ")}`,
  );

  return factory(env, opts);
}

/** The credential each vendor needs; a vendor absent here (vertex, ollama, cli) needs none in the environment. */
const REQUIRED_CREDENTIAL: Partial<Record<string, string>> = {
  openai: "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
};

/** Whether the process has what the vendor it selects needs to make a call, so a job that needs a model can skip itself instead of failing on every run. */
export function llmConfigured(env: NodeJS.ProcessEnv): boolean {
  const credential = REQUIRED_CREDENTIAL[resolveVendor(env)];

  return credential === undefined || Boolean(env[credential]);
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
