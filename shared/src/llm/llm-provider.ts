/**
 * The vendor-neutral LLM completion seam. Every model call in Lore goes through
 * an `LlmProvider` (resolved via the {@link Llm} singleton), so vendors are
 * swappable, cost/caching is reasoned about in one place, and a deterministic
 * path can be *proven* model-free by installing the throwing NoLlmProvider.
 *
 * Two modalities: plain text `complete` and forced-tool/structured
 * `completeWithTool`. The agentic `claude --print` CLI and Vertex embeddings are
 * deliberately NOT modelled here — different modalities.
 */

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
  data: T;
}

export interface LlmProvider {
  /** Vendor discriminator: "anthropic" | "openai" | "ollama" | "none" | "fake". */
  readonly vendor: string;
  complete(req: LlmCompleteRequest): Promise<LlmCompletion>;
  completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>>;
}
