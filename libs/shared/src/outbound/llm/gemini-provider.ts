// Google Gemini provider: raw `fetch`, no `@google/generative-ai` dep; structured output uses `responseMimeType: "application/json"` since Gemini has no `tool_choice`-equivalent forced-tool-call primitive.

import { enforceTrue } from "../../lib/enforce.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import {
  recordCall,
  recordFailure,
  type LlmCallMetrics,
} from "./llm-call-accounting.js";
import { computeGeminiCost } from "./gemini-pricing.js";
import {
  textFromResponse,
  tokensFromResponse,
  type GeminiResponse,
} from "./gemini-response.js";

export { computeGeminiCost, GEMINI_MODEL_PRICING } from "./gemini-pricing.js";
import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const ZERO_CACHE = { cacheCreationTokens: 0, cacheReadTokens: 0 };

const DEFAULT_MODEL = "gemini-2.5-flash";

/** Where one generateContent call goes and what authenticates it. */
export interface GenerateTarget {
  url: string;
  headers: Record<string, string>;
}

/** Names the target for a model at call time, so a credential is read when it is needed and never at boot. */
export type GenerateEndpoint = (model: string) => Promise<GenerateTarget>;

export interface GeminiProviderOptions {
  model?: string;
  apiKey?: string;
  usage?: UsagePort;
  fetchFn?: typeof fetch;
  /** The Gemini API by key unless another host serves the same body (Vertex). */
  endpoint?: GenerateEndpoint;
  vendor?: string;
  /** How long one generateContent call may take before it fails; a stalled call otherwise hangs its caller for good. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;

/** One generateContent call's inputs, grouped so the request body and its caller agree on exactly what a call carries. */
interface GenerateRequest {
  prompt: string;
  systemPrompt?: string;
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  model: string;
}

/** The generateContent request body. A system instruction and a response schema are both omitted entirely when absent rather than sent empty — Gemini treats a present-but-blank `systemInstruction` as an instruction. */
function generateBody(req: GenerateRequest): Record<string, unknown> {
  const generationConfig = generationConfigOf(req);

  return {
    ...(req.systemPrompt
      ? { systemInstruction: { parts: [{ text: req.systemPrompt }] } }
      : {}),
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
}

/** A Gemini 3 model reasons at a dynamic (high) level unless told otherwise; Lore's calls are extraction and write-up, so they take the low level. */
const GEMINI_3_RE = /^gemini-3/;

function generationConfigOf({
  temperature,
  responseSchema,
  maxTokens,
  model,
}: GenerateRequest): Record<string, unknown> {
  return {
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
    ...(GEMINI_3_RE.test(model)
      ? { thinkingConfig: { thinkingLevel: "low" } }
      : {}),
    ...(responseSchema
      ? { responseMimeType: "application/json", responseSchema }
      : {}),
  };
}

function generateInit(
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
): RequestInit {
  return {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  };
}

function apiKeyEndpoint(configuredKey?: string): GenerateEndpoint {
  return async (model) => {
    const apiKey = configuredKey ?? process.env.GEMINI_API_KEY;

    enforceTrue(apiKey, Error, "GEMINI_API_KEY not set");

    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
    };
  };
}

export class GeminiProvider implements LlmProvider {
  readonly vendor: string;
  private readonly endpoint: GenerateEndpoint;

  constructor(private readonly opts: GeminiProviderOptions = {}) {
    this.vendor = opts.vendor ?? "gemini";
    this.endpoint = opts.endpoint ?? apiKeyEndpoint(opts.apiKey);
  }

  private get model(): string {
    return this.opts.model || DEFAULT_MODEL;
  }

  private async generate(
    model: string,
    req: GenerateRequest,
  ): Promise<GeminiResponse> {
    const { url, headers } = await this.endpoint(model);
    const doFetch = this.opts.fetchFn ?? fetch;
    const res = await doFetch(
      url,
      generateInit(
        headers,
        generateBody(req),
        this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ),
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
  ): LlmCallMetrics & { text: string } {
    const durationMs = Date.now() - start;
    const text = textFromResponse(response);
    const { inputTokens, outputTokens } = tokensFromResponse(response);
    const costUsd = computeGeminiCost(model, inputTokens, outputTokens);

    return { text, model, inputTokens, outputTokens, costUsd, durationMs };
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const model = req.model || this.model;
    const start = Date.now();

    try {
      const response = await this.generate(model, { ...req, model });
      const metrics = this.summarizeCall(model, response, start);

      await recordCall(this.opts.usage, req, "call", metrics);

      return { ...metrics, ...ZERO_CACHE };
    } catch (err) {
      await recordFailure(
        this.opts.usage,
        { req, model, start, kind: "call" },
        err,
      );
      throw err;
    }
  }

  private async toolCallMetrics(
    req: LlmToolRequest,
    model: string,
    start: number,
  ): Promise<LlmCallMetrics & { text: string }> {
    const response = await this.generate(model, {
      ...req,
      model,
      responseSchema: req.toolSchema,
    });
    const metrics = this.summarizeCall(model, response, start);

    await recordCall(this.opts.usage, req, "tool call", metrics);

    return metrics;
  }

  async completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>> {
    const model = req.model || this.model;
    const start = Date.now();

    try {
      const metrics = await this.toolCallMetrics(req, model, start);

      return {
        ...metrics,
        parsed: JSON.parse(metrics.text) as T,
        ...ZERO_CACHE,
      };
    } catch (err) {
      await recordFailure(
        this.opts.usage,
        { req, model, start, kind: "tool call" },
        err,
      );
      throw err;
    }
  }
}
