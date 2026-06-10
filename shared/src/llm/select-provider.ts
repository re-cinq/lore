/**
 * Resolves the active {@link LlmProvider} from the environment. Precedence:
 * `LORE_LLM_PROVIDER` (the general switch) over `LORE_FACT_LLM` (the legacy
 * memory-only one), defaulting to Anthropic. Model is taken from the
 * vendor-appropriate env var.
 */

import type { LlmProvider } from "./llm-provider.js";
import type { PgPool } from "../memory-store.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import { OllamaProvider } from "./ollama-provider.js";

export function selectProvider(env: NodeJS.ProcessEnv, opts: { costPool?: PgPool } = {}): LlmProvider {
  const vendor = (env.LORE_LLM_PROVIDER || env.LORE_FACT_LLM || "claude").toLowerCase();
  switch (vendor) {
    case "openai":
      return new OpenAiProvider({ model: env.LORE_FACT_MODEL || "gpt-4o-mini" });
    case "ollama":
      return new OllamaProvider({ model: env.LORE_FACT_MODEL || "llama3" });
    case "claude":
    case "anthropic":
    default:
      return new AnthropicProvider({ model: env.ANTHROPIC_MODEL, costPool: opts.costPool });
  }
}
