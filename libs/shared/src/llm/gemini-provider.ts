// Google Gemini provider: raw `fetch` (mirrors `openai-provider.ts`, no `@google/generative-ai` dep); structured output uses `responseMimeType: "application/json"` since Gemini has no `tool_choice`-equivalent forced-tool-call primitive.

import { enforceTrue } from "../lib/enforce.js";
import type { LlmCallRecord, UsagePort } from "../project/usage/usage-port.js";
import type { ModelPricing } from "./model-pricing.js";
import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const ZERO_CACHE = { cacheCreationTokens: 0, cacheReadTokens: 0 };

// $/token for prompts under the 200k-token tier boundary, read off https://ai.google.dev/gemini-api/docs/pricing on 2026-09-01 — reverify before relying on this table (3.7 Flash is a launch price through 2026-12-31, then doubles).
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
  "gemini-3.1-pro-preview": {
    inputPerToken: 2.0 / 1_000_000,
    outputPerToken: 12.0 / 1_000_000,
  },
  "gemini-3.7-flash": {
    inputPerToken: 0.75 / 1_000_000,
    outputPerToken: 3.75 / 1_000_000,
  },
  "gemini-3.1-flash-lite": {
    inputPerToken: 0.25 / 1_000_000,
    outputPerToken: 1.5 / 1_000_000,
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

interface GeminiCallMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

function candidateParts(
  response: GeminiResponse,
): Array<{ text?: string }> | undefined {
  const candidate = response.candidates?.[0];

  return candidate?.content?.parts;
}

function textFromResponse(response: GeminiResponse): string {
  const part = candidateParts(response)?.[0];

  return part?.text ?? "";
}

function tokensFromResponse(response: GeminiResponse): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

function usageLogEntry(
  req: { taskId?: string; jobName?: string },
  metrics: GeminiCallMetrics,
): LlmCallRecord {
  return {
    taskId: req.taskId || null,
    jobName: req.jobName || null,
    model: metrics.model,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
  };
}

function warnIfUncorrelated(
  result: { correlated: boolean } | null,
  taskId?: string,
): void {
  if (!result || result.correlated || !taskId) {
    return;
  }
  console.warn(
    `[llm] cost row uncorrelated: id ${taskId} matched no pipeline.tasks or pipeline.assembly_runs row`,
  );
}

function logCallLine(kind: string, metrics: GeminiCallMetrics): void {
  console.log(
    `[llm] ${kind}: ${metrics.model} ${metrics.inputTokens}+${metrics.outputTokens} tokens $${metrics.costUsd.toFixed(4)} ${metrics.durationMs}ms`,
  );
}

function logCallFailure(kind: string, err: unknown): void {
  console.error(`[llm] ${kind} failed:`, err);
}

export class GeminiProvider implements LlmProvider {
  readonly vendor = "gemini";

  constructor(private readonly opts: GeminiProviderOptions = {}) {}

  private get model(): string {
    return this.opts.model || DEFAULT_MODEL;
  }

  private async logCall(
    req: { taskId?: string; jobName?: string },
    metrics: GeminiCallMetrics,
  ): Promise<void> {
    if (!this.opts.usage) {
      return;
    }
    const result = await this.opts.usage
      .logLlmCall(usageLogEntry(req, metrics))
      .catch(() => null);

    warnIfUncorrelated(result, req.taskId);
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

  private summarizeCall(
    model: string,
    response: GeminiResponse,
    start: number,
  ): GeminiCallMetrics & { text: string } {
    const durationMs = Date.now() - start;
    const text = textFromResponse(response);
    const { inputTokens, outputTokens } = tokensFromResponse(response);
    const costUsd = computeGeminiCost(model, inputTokens, outputTokens);

    return { text, model, inputTokens, outputTokens, costUsd, durationMs };
  }

  private async reportFailure(
    attempt: {
      req: { taskId?: string; jobName?: string };
      model: string;
      start: number;
      kind: string;
    },
    err: unknown,
  ): Promise<void> {
    logCallFailure(attempt.kind, err);
    await this.recordFailedCall(
      attempt.req,
      attempt.model,
      Date.now() - attempt.start,
      (err as Error).message,
    );
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const model = req.model || this.model;
    const start = Date.now();

    try {
      const response = await this.generate(model, req.systemPrompt, req.prompt);
      const metrics = this.summarizeCall(model, response, start);

      await this.logCall(req, metrics);
      logCallLine("call", metrics);

      return { ...metrics, ...ZERO_CACHE };
    } catch (err) {
      await this.reportFailure({ req, model, start, kind: "call" }, err);
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
      const metrics = this.summarizeCall(model, response, start);

      enforceTrue(
        metrics.text,
        Error,
        "Gemini returned no content in candidates",
      );
      await this.logCall(req, metrics);
      logCallLine("tool call", metrics);

      return {
        ...metrics,
        parsed: JSON.parse(metrics.text) as T,
        ...ZERO_CACHE,
      };
    } catch (err) {
      await this.reportFailure({ req, model, start, kind: "tool call" }, err);
      throw err;
    }
  }
}
