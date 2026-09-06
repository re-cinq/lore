// Direct-LLM port for the agents `direct` mode; the runtime injects a client wrapping the SDK — shared never imports it.

export interface LlmCompletion {
  text: string;
}

export interface LlmPort {
  complete(
    prompt: string,
    opts?: { model?: string; maxTokens?: number },
  ): Promise<LlmCompletion>;
}
