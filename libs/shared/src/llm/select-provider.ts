/** Resolves the active {@link LlmProvider} from env: `LORE_LLM_PROVIDER` over legacy `LORE_FACT_LLM`, defaulting to Anthropic; model from the vendor-appropriate env var. */

import type { LlmProvider } from "./llm-provider.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { CliProvider } from "./cli-provider.js";

export function selectProvider(
  env: NodeJS.ProcessEnv,
  opts: { usage?: UsagePort } = {},
): LlmProvider {
  const vendor = (
    env.LORE_LLM_PROVIDER ||
    env.LORE_FACT_LLM ||
    "claude"
  ).toLowerCase();

  switch (vendor) {
    case "openai":
      return new OpenAiProvider({
        model: env.LORE_FACT_MODEL || "gpt-4o-mini",
      });
    case "ollama":
      return new OllamaProvider({ model: env.LORE_FACT_MODEL || "llama3" });
    case "gemini":
      return new GeminiProvider({
        model: env.LORE_FACT_MODEL || "gemini-2.5-flash",
        apiKey: env.GEMINI_API_KEY,
        usage: opts.usage,
      });
    case "cli":
      return new CliProvider();
    case "claude":
    case "anthropic":
    default:
      // No API key → fall back to the `claude` CLI (subscription, zero API spend).
      if (!env.ANTHROPIC_API_KEY) {
        return new CliProvider();
      }

      return new AnthropicProvider({
        model: env.ANTHROPIC_MODEL,
        usage: opts.usage,
      });
  }
}
