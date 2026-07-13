import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/**
 * OpenAI (and OpenAI-compatible, e.g. Codex) chat-completions provider. Moved
 * from the facts.ts vendor switch and generalized: the request's systemPrompt +
 * prompt drive the messages instead of a hardcoded extraction prompt. The fetch
 * boundary is injectable for tests.
 *
 * Tool/structured output uses JSON-mode with a parse fallback — Anthropic remains
 * the forced-tool path for tool-heavy callers.
 */

import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const ZERO_CACHE = { cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0 };

export interface OpenAiProviderOptions {
  model: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
}

export class OpenAiProvider implements LlmProvider {
  readonly vendor = "openai";

  constructor(private readonly opts: OpenAiProviderOptions) {}

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const text = await this.chat(req.systemPrompt, req.prompt);
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
    const text = await this.chat(
      req.systemPrompt ? `${req.systemPrompt}\n${instruction}` : instruction,
      req.prompt,
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

  private async chat(
    systemPrompt: string | undefined,
    prompt: string,
  ): Promise<string> {
    const apiKey = this.opts.apiKey ?? process.env.OPENAI_API_KEY;
    enforceTrue(apiKey, new Error("OPENAI_API_KEY not set"));
    const messages = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: prompt },
    ];
    const doFetch = this.opts.fetchFn ?? fetch;
    const res = await doFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.opts.model,
        messages,
        temperature: 0,
      }),
    });
    if (!res.ok)
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return json.choices[0].message.content;
  }
}
