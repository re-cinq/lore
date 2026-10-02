/** Route helpers: the graph-extraction LLM caller. */

import type { Pool } from "pg";
import { Llm } from "@re-cinq/lore-shared";

/** Graph LLM caller via shared Llm singleton; undefined when Anthropic key is missing. */
export function makeGraphLlmCall(
  _pool: Pool | null,
): ((prompt: string) => Promise<string>) | undefined {
  if (!process.env.ANTHROPIC_API_KEY) {
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
