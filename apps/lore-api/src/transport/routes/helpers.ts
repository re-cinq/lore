/** Route helpers: the graph-extraction LLM caller. */

import type { Pool } from "pg";
import { Llm, llmConfigured } from "@re-cinq/lore-shared";

/** Graph LLM caller via shared Llm singleton; undefined when the selected vendor has no key. */
export function makeGraphLlmCall(
  _pool: Pool | null,
): ((prompt: string) => Promise<string>) | undefined {
  if (!llmConfigured(process.env)) {
    return undefined;
  }

  const llm = Llm.instance;

  return async (prompt: string) => {
    const { text } = await llm.complete({
      prompt,
      jobName: "graph-extraction",
    });

    return text;
  };
}
