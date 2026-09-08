/** Graph-extraction LLM call closure routed through shared Llm singleton (provider selection + cost logging). */

import { Llm } from "@re-cinq/lore-shared";

export function createGraphLlmCall(
  _pool: unknown,
): (prompt: string) => Promise<string> {
  const llm = Llm.instance;

  return (prompt: string) =>
    llm.complete({ prompt, jobName: "graph-extraction" }).then((r) => r.text);
}
