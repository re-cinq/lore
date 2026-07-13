/**
 * Direct-LLM port for the agents `direct` mode. The runtime injects a client
 * wrapping the Anthropic SDK (or any provider); shared never imports the SDK.
 */

export interface LlmCompletion {
  text: string;
}

export interface LlmPort {
  complete(
    prompt: string,
    opts?: { model?: string; maxTokens?: number },
  ): Promise<LlmCompletion>;
}
