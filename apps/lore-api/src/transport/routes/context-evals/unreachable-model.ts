import type { LlmProvider } from "@re-cinq/lore-shared/llm/llm-provider.js";

/** A model that refuses every call with one message: what a retired model id or an unreachable vendor looks like to a route. */
export class UnreachableModel implements LlmProvider {
  readonly vendor = "unreachable";

  constructor(private readonly reason: string) {}

  async complete(): Promise<never> {
    throw new Error(this.reason);
  }

  async completeWithTool(): Promise<never> {
    throw new Error(this.reason);
  }
}
