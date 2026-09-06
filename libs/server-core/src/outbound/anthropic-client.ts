/** Graph-extraction LLM call closure routed through shared Llm singleton (provider selection + cost logging). */

import { Llm } from "@re-cinq/lore-shared";

export function createGraphLlmCall(
  _pool: unknown,
): (prompt: string) => Promise<string> {
  return (prompt: string) =>
    Llm.instance
      .complete({ prompt, jobName: "graph-extraction" })
      .then((r) => r.text);
}
