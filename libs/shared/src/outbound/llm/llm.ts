// `Llm` — the process-wide singleton holding the active {@link LlmProvider}; `configure` wires the {@link UsagePort} used by the Anthropic provider's `pipeline.llm_calls` cost logging.

import type { LlmProvider } from "./llm-provider.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import { selectProvider } from "./select-provider.js";

let current: LlmProvider | null = null;
let usage: UsagePort | undefined;

export class Llm {
  static get instance(): LlmProvider {
    if (!current) {
      current = selectProvider(process.env, { usage });
    }

    return current;
  }

  static setInstance(provider: LlmProvider): void {
    current = provider;
  }

  static reset(): void {
    current = null;
  }

  static configure(opts: { usage?: UsagePort }): void {
    usage = opts.usage;
    current = null;
  }

  /** True when a UsagePort was configured — checked by the station runner before installing its own tracker, so a call is never cost-counted by both transports. */
  static get usageConfigured(): boolean {
    return usage !== undefined;
  }
}
