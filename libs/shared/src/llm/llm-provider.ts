/** The vendor-neutral LLM completion seam: every model call goes through an `LlmProvider` (via the {@link Llm} singleton) with two modalities, plain `complete` and forced-tool `completeWithTool`; deliberately excludes the agentic CLI and Vertex embeddings (different modalities). */

/** Token/cost/timing metrics returned with every call. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
}

export interface LlmCompleteRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  taskId?: string;
  jobName?: string;
}

export interface LlmCompletion extends LlmUsage {
  text: string;
}

export interface LlmToolRequest extends LlmCompleteRequest {
  toolName: string;
  toolDescription: string;
  toolSchema: Record<string, unknown>;
}

export interface LlmToolResult<T> extends LlmUsage {
  /** The structured value the tool call parsed out of the model's reply. */
  parsed: T;
}

export interface LlmProvider {
  /** Vendor discriminator: "anthropic" | "openai" | "ollama" | "gemini" | "none" | "fake". */
  readonly vendor: string;
  complete(req: LlmCompleteRequest): Promise<LlmCompletion>;
  completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>>;
}
