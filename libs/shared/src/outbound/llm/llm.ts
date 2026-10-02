// `Llm` — the process-wide singleton holding the active {@link LlmProvider}; `configure` wires the {@link UsagePort} used by the Anthropic provider's `pipeline.llm_calls` cost logging.

import type { LlmProvider } from "./llm-provider.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import {
  selectProvider,
  selectProviderFor,
  useNamesProvider,
} from "./select-provider.js";

let current: LlmProvider | null = null;
let usage: UsagePort | undefined;
const perUse = new Map<string, LlmProvider>();

export class Llm {
  static get instance(): LlmProvider {
    if (!current) {
      current = selectProvider(process.env, { usage });
    }

    return current;
  }

  /** The provider a named use runs on: its own when `LORE_<USE>_LLM_PROVIDER` names a vendor, the process-wide one otherwise. */
  static for(use: string): LlmProvider {
    if (!useNamesProvider(use, process.env)) {
      return Llm.instance;
    }
    const held = perUse.get(use);

    if (held) {
      return held;
    }
    const provider = selectProviderFor(use, process.env, { usage });

    perUse.set(use, provider);

    return provider;
  }

  static setInstance(provider: LlmProvider): void {
    current = provider;
  }

  static reset(): void {
    current = null;
    perUse.clear();
  }

  static configure(opts: { usage?: UsagePort }): void {
    usage = opts.usage;
    current = null;
    perUse.clear();
  }

  /** True when a UsagePort was configured — checked by the station runner before installing its own tracker, so a call is never cost-counted by both transports. */
  static get usageConfigured(): boolean {
    return usage !== undefined;
  }
}
