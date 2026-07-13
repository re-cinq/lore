/**
 * `Llm` — the process-wide singleton holding the active {@link LlmProvider}.
 * Callers use `Llm.instance.complete(...)`; boot and tests swap the provider via
 * `setInstance`. The lazy default is resolved from the environment
 * ({@link selectProvider}) on first access. `configure` wires the cost-tracking
 * pool used by the Anthropic provider's `pipeline.llm_calls` logging.
 */

import type { LlmProvider } from "./llm-provider.js";
import type { PgPool } from "../memory-store.js";
import { selectProvider } from "./select-provider.js";

let current: LlmProvider | null = null;
let costPool: PgPool | undefined;

export class Llm {
  static get instance(): LlmProvider {
    if (!current) {
      current = selectProvider(process.env, { costPool });
    }

    return current;
  }

  static setInstance(provider: LlmProvider): void {
    current = provider;
  }

  static reset(): void {
    current = null;
  }

  static configure(opts: { costPool?: PgPool }): void {
    costPool = opts.costPool;
    current = null;
  }
}
