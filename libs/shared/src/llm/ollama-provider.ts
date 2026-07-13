/**
 * Ollama (local) provider. Moved from the facts.ts vendor switch and generalized
 * to systemPrompt + prompt. Tool/structured output uses a JSON-prompt fallback.
 */

import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const ZERO_CACHE = { cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0 };

export interface OllamaProviderOptions {
  model: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class OllamaProvider implements LlmProvider {
  readonly vendor = "ollama";

  constructor(private readonly opts: OllamaProviderOptions) {}

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const text = await this.generate(
      this.combine(req.systemPrompt, req.prompt),
    );
    return {
      text,
      model: this.opts.model,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      ...ZERO_CACHE,
    };
  }

  async completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>> {
    const instruction = `${req.toolDescription}\nRespond with ONLY a JSON object matching this schema: ${JSON.stringify(req.toolSchema)}`;
    const text = await this.generate(
      this.combine(
        req.systemPrompt ? `${req.systemPrompt}\n${instruction}` : instruction,
        req.prompt,
      ),
    );
    return {
      data: JSON.parse(text) as T,
      model: this.opts.model,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      ...ZERO_CACHE,
    };
  }

  private combine(systemPrompt: string | undefined, prompt: string): string {
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  }

  private async generate(prompt: string): Promise<string> {
    const baseUrl =
      this.opts.baseUrl ??
      process.env.LORE_OLLAMA_URL ??
      "http://localhost:11434";
    const doFetch = this.opts.fetchFn ?? fetch;
    const res = await doFetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.opts.model, prompt, stream: false }),
    });
    if (!res.ok)
      throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { response: string };
    return json.response;
  }
}
