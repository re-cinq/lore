/**
 * Graph-extraction LLM call closure, routed through the shared `Llm` singleton.
 * Provider selection + cost logging live behind `Llm` (configured at boot via
 * `Llm.configure`). The old direct Messages-API / Claude-CLI fallback was folded
 * into the provider layer — a future CliProvider can restore the subscription
 * path behind the same interface.
 */

import { Llm } from "@re-cinq/lore-shared";

export function createGraphLlmCall(
  _pool: unknown,
): (prompt: string) => Promise<string> {
  return (prompt: string) =>
    Llm.instance
      .complete({ prompt, jobName: "graph-extraction" })
      .then((r) => r.text);
}
