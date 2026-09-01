/**
 * Google Gemini provider. Raw `fetch` against the Generative Language API —
 * mirrors `openai-provider.ts`'s hand-rolled-HTTP shape rather than adding a
 * `@google/generative-ai` dependency. Tool/structured output uses Gemini's
 * `responseMimeType: "application/json"` mode with a parse fallback, the same
 * pattern `OpenAiProvider.completeWithTool` uses — Gemini has no forced-tool-call
 * primitive equivalent to Anthropic's `tool_choice`.
 *
 * Cost logging goes through an injected `UsagePort`, same as
 * `AnthropicProvider` — a caller passing an assembly-line id as `taskId` lands
 * on `assembly_run_id` instead of being FK-rejected. Port absent → logging is
 * skipped.
 */

import { enforceTrue } from "../lib/enforce.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import type { ModelPricing } from "./model-pricing.js";
import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const ZERO_CACHE = { cacheCreationTokens: 0, cacheReadTokens: 0 };

// $/token, derived from published $/1M rates for prompts under the 200k-token
// tier boundary (Pro/Flash step to a higher rate above it — not modelled here,
// most Lore-internal jobs stay well under it). Reverify current figures at
// https://ai.google.dev/gemini-api/docs/pricing before relying on this table;
// Gemini pricing changes more often than Anthropic's.
export const GEMINI_MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-pro": {
    inputPerToken: 1.25 / 1_000_000,
    outputPerToken: 10.0 / 1_000_000,
  },
  "gemini-2.5-flash": {
    inputPerToken: 0.3 / 1_000_000,
    outputPerToken: 2.5 / 1_000_000,
  },
  "gemini-2.5-flash-lite": {
    inputPerToken: 0.1 / 1_000_000,
    outputPerToken: 0.4 / 1_000_000,
  },
};

const FALLBACK_PRICING = GEMINI_MODEL_PRICING["gemini-2.5-flash"];

export function computeGeminiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = GEMINI_MODEL_PRICING[model] ?? FALLBACK_PRICING;

  return (
    inputTokens * pricing.inputPerToken + outputTokens * pricing.outputPerToken
  );
}

const DEFAULT_MODEL = "gemini-2.5-flash";

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: GeminiUsageMetadata;
}

export interface GeminiProviderOptions {
  model?: string;
  apiKey?: string;
  usage?: UsagePort;
  fetchFn?: typeof fetch;
}

export class GeminiProvider implements LlmProvider {
  readonly vendor = "gemini";

  constructor(private readonly opts: GeminiProviderOptions = {}) {}

  private get model(): string {
    return this.opts.model || DEFAULT_MODEL;
  }

  private async logCall(
    req: { taskId?: string; jobName?: string },
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    durationMs: number,
  ): Promise<void> {
    if (!this.opts.usage) {
      return;
    }
    const result = await this.opts.usage
      .logLlmCall({
        taskId: req.taskId || null,
        jobName: req.jobName || null,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      })
      .catch(() => null);

    if (result && !result.correlated && req.taskId) {
      console.warn(
        `[llm] cost row uncorrelated: id ${req.taskId} matched no pipeline.tasks or pipeline.assembly_runs row`,
      );
    }
  }

  private async recordFailedCall(
    req: { taskId?: string; jobName?: string },
    model: string,
    durationMs: number,
    message: string,
  ): Promise<void> {
    if (!this.opts.usage) {
      return;
    }
    await this.opts.usage
      .logLlmCall({
        taskId: req.taskId || null,
        jobName: req.jobName || null,
        model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs,
        status: "failed",
        error: message,
      })
      .catch(() => null);
  }

  private async generate(
    model: string,
    systemPrompt: string | undefined,
    prompt: string,
    responseSchema?: Record<string, unknown>,
  ): Promise<GeminiResponse> {
    const apiKey = this.opts.apiKey ?? process.env.GEMINI_API_KEY;

    enforceTrue(apiKey, Error, "GEMINI_API_KEY not set");
    const doFetch = this.opts.fetchFn ?? fetch;
    const res = await doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(systemPrompt
            ? { systemInstruction: { parts: [{ text: systemPrompt }] } }
            : {}),
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          ...(responseSchema
            ? {
                generationConfig: {
                  responseMimeType: "application/json",
                  responseSchema,
                },
              }
            : {}),
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as GeminiResponse;
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const model = req.model || this.model;
    const start = Date.now();

    try {
      const response = await this.generate(model, req.systemPrompt, req.prompt);
      const durationMs = Date.now() - start;
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
      const costUsd = computeGeminiCost(model, inputTokens, outputTokens);

      await this.logCall(
        req,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      );
      console.log(
        `[llm] call: ${model} ${inputTokens}+${outputTokens} tokens $${costUsd.toFixed(4)} ${durationMs}ms`,
      );

      return {
        text,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
        ...ZERO_CACHE,
      };
    } catch (err) {
      console.error("[llm] call failed:", err);
      await this.recordFailedCall(
        req,
        model,
        Date.now() - start,
        (err as Error).message,
      );
      throw err;
    }
  }

  async completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>> {
    const model = req.model || this.model;
    const start = Date.now();

    try {
      const response = await this.generate(
        model,
        req.systemPrompt,
        req.prompt,
        req.toolSchema,
      );
      const durationMs = Date.now() - start;
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      enforceTrue(text, Error, "Gemini returned no content in candidates");
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
      const costUsd = computeGeminiCost(model, inputTokens, outputTokens);

      await this.logCall(
        req,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      );
      console.log(
        `[llm] tool call: ${model} ${inputTokens}+${outputTokens} tokens $${costUsd.toFixed(4)} ${durationMs}ms`,
      );

      return {
        data: JSON.parse(text) as T,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
        ...ZERO_CACHE,
      };
    } catch (err) {
      console.error("[llm] tool call failed:", err);
      await this.recordFailedCall(
        req,
        model,
        Date.now() - start,
        (err as Error).message,
      );
      throw err;
    }
  }
}
