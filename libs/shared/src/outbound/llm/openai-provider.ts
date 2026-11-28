// OpenAI-compatible provider: raw `fetch` against `{baseUrl}/chat/completions`, so it serves OpenAI, Azure/Microsoft Foundry's `/openai/v1` and any other host that speaks the same body. Structured output is a forced function call.

import { enforceTrue } from "../../lib/enforce.js";
import {
  openAiAuthInit,
  type OpenAiAuthHeader,
} from "../openai/openai-auth.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import {
  recordCall,
  recordFailure,
  type LlmCallMetrics,
} from "./llm-call-accounting.js";
import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmUsage,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 90_000;

export interface OpenAiProviderOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** The header that carries the key (`LORE_OPENAI_AUTH_HEADER`); a bearer token when unset. */
  authHeader?: OpenAiAuthHeader;
  usage?: UsagePort;
  fetchFn?: typeof fetch;
  /** How long one call may take before it fails; a stalled call otherwise hangs its caller for good. */
  timeoutMs?: number;
}

interface ChatMessage {
  content?: string | null;
  tool_calls?: Array<{ function?: { arguments?: string } }>;
}

interface ChatChoice {
  message?: ChatMessage;
  finish_reason?: string;
}

interface ChatResponse {
  choices?: ChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

type ToolChoiceBody = Pick<ChatBody, "tools" | "tool_choice">;

interface ChatBody {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_completion_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
}

/** `temperature` is left out on purpose: newer OpenAI models refuse any value but their default. */
function chatBody(
  req: LlmCompleteRequest,
  model: string,
  tool?: ToolChoiceBody,
): ChatBody {
  return {
    model,
    messages: [
      ...(req.systemPrompt
        ? [{ role: "system" as const, content: req.systemPrompt }]
        : []),
      { role: "user", content: req.prompt },
    ],
    ...(req.maxTokens === undefined
      ? {}
      : { max_completion_tokens: req.maxTokens }),
    ...tool,
  };
}

function forcedToolOf(req: LlmToolRequest): ToolChoiceBody {
  return {
    tools: [
      {
        type: "function",
        function: {
          name: req.toolName,
          description: req.toolDescription,
          parameters: req.toolSchema,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: req.toolName } },
  };
}

function textOf(response: ChatResponse): string {
  const choice = firstChoice(response);
  const text = choice.message?.content;

  enforceTrue(
    Boolean(text),
    Error,
    `OpenAI returned no text (${whyNoValue(choice)})`,
  );

  return text as string;
}

function toolArgumentsOf(response: ChatResponse): string {
  const choice = firstChoice(response);
  const call = (choice.message?.tool_calls ?? []).at(0);
  const toolArguments = call?.function?.arguments;

  enforceTrue(
    Boolean(toolArguments),
    Error,
    `OpenAI returned no tool call (${whyNoValue(choice)})`,
  );

  return toolArguments as string;
}

function metricsOf(
  model: string,
  response: ChatResponse,
  start: number,
): Required<LlmCallMetrics> {
  return {
    model,
    ...tokensOf(response.usage ?? {}),
    costUsd: 0,
    durationMs: Date.now() - start,
  };
}

function firstChoice(response: ChatResponse): ChatChoice {
  return response.choices?.[0] ?? {};
}

function whyNoValue(choice: ChatChoice): string {
  return choice.finish_reason ?? "no choice";
}

function tokensOf(usage: NonNullable<ChatResponse["usage"]>): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
} {
  const details = usage.prompt_tokens_details ?? {};

  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    cacheReadTokens: details.cached_tokens ?? 0,
  };
}

export class OpenAiProvider implements LlmProvider {
  readonly vendor = "openai";
  private readonly baseUrl: string;

  constructor(private readonly opts: OpenAiProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private modelFor(req: LlmCompleteRequest): string {
    const model = req.model || this.opts.model;

    enforceTrue(
      Boolean(model),
      Error,
      "OpenAI-compatible model not set: set LORE_FACT_MODEL to the model or deployment name",
    );

    return model as string;
  }

  private async post(body: ChatBody): Promise<ChatResponse> {
    const { apiKey } = this.opts;

    enforceTrue(apiKey, Error, "OPENAI_API_KEY not set");

    const doFetch = this.opts.fetchFn ?? fetch;
    const res = await doFetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      ...openAiAuthInit(apiKey, this.opts.authHeader),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    enforceTrue(
      res.ok,
      Error,
      `OpenAI API error: ${res.status} ${res.statusText}`,
    );

    return (await res.json()) as ChatResponse;
  }

  /** One accounted call: posts the body, turns the reply into a value, and writes the usage row and log line, or the failed row. */
  private async accounted<T>(
    kind: string,
    req: LlmCompleteRequest,
    body: (model: string) => ChatBody,
    valueOf: (response: ChatResponse) => T,
  ): Promise<{ usage: LlmUsage; value: T }> {
    const model = this.modelFor(req);
    const start = Date.now();

    try {
      const response = await this.post(body(model));
      const value = valueOf(response);
      const metrics = metricsOf(model, response, start);

      await recordCall(this.opts.usage, req, kind, metrics);

      return { usage: { ...metrics, cacheCreationTokens: 0 }, value };
    } catch (err) {
      await recordFailure(this.opts.usage, { req, model, start, kind }, err);
      throw err;
    }
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const { usage, value } = await this.accounted(
      "call",
      req,
      (model) => chatBody(req, model),
      textOf,
    );

    return { ...usage, text: value };
  }

  async completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>> {
    const { usage, value } = await this.accounted(
      "tool call",
      req,
      (model) => chatBody(req, model, forcedToolOf(req)),
      (response) => JSON.parse(toolArgumentsOf(response)) as T,
    );

    return { ...usage, parsed: value };
  }
}
