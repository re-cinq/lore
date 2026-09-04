import { enforceTrue } from "../lib/enforce.js";
import type { LlmCallOutcome } from "./call-outcome.js";
/** Anthropic provider; proven logic with caching/cost/retries; logging via injected UsagePort (routing-aware, assembly_run_id not FK-rejected). */

import Anthropic from "@anthropic-ai/sdk";
import type { UsagePort } from "../project/usage/usage-port.js";
import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";
import {
  getCacheControl,
  computeCachePrefixHash,
  analyzeCacheBreak,
  type CacheBreakAnalysis,
} from "./prompt-cache.js";
import type { ModelPricing } from "./model-pricing.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 8192;

// $/token from published $/1M rates; cache 1.25x write/0.1x read multipliers; reverify vs shared/live-sources.md when adding tier.
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": {
    inputPerToken: 10.0 / 1_000_000,
    outputPerToken: 50.0 / 1_000_000,
  },
  "claude-opus-5": {
    inputPerToken: 5.0 / 1_000_000,
    outputPerToken: 25.0 / 1_000_000,
  },
  "claude-opus-4-8": {
    inputPerToken: 5.0 / 1_000_000,
    outputPerToken: 25.0 / 1_000_000,
  },
  "claude-sonnet-5": {
    inputPerToken: 2.0 / 1_000_000,
    outputPerToken: 10.0 / 1_000_000,
  },
  "claude-sonnet-4-6": {
    inputPerToken: 3.0 / 1_000_000,
    outputPerToken: 15.0 / 1_000_000,
  },
  "claude-haiku-4-5-20251001": {
    inputPerToken: 0.8 / 1_000_000,
    outputPerToken: 4.0 / 1_000_000,
  },
};

// Unrecognized model (new tier or dated snapshot) uses cheapest tier for logging (least-wrong default cost).
const FALLBACK_PRICING = MODEL_PRICING["claude-haiku-4-5-20251001"];

function pricingFor(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

export function buildCacheableSystem(
  systemPrompt: string,
  jobName?: string,
): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: systemPrompt,
      cache_control: getCacheControl(jobName),
    },
  ];
}

export function buildCacheableTools(
  toolName: string,
  toolDescription: string,
  toolSchema: Anthropic.Tool.InputSchema,
  jobName?: string,
): Anthropic.Tool[] {
  return [
    {
      name: toolName,
      description: toolDescription,
      input_schema: toolSchema,
      cache_control: getCacheControl(jobName),
    },
  ];
}

function orUnknown(value: string | number | undefined): string | number {
  return value ?? "?";
}

function formatBreakLogTag(a: CacheBreakAnalysis): string {
  switch (a.status) {
    case "hit":
      return "hit";
    case "first-call":
      return "first-call";
    case "prompt-changed":
      return `break:${orUnknown(a.reason)}`;
    case "ttl-expired":
      return `break:ttl(${orUnknown(a.ageMinutes)}m)`;
    case "unknown-miss":
      return "miss:?";
  }
}

/** Resolves the model/maxTokens/system-param triple shared by every completion call. */
function resolveModel(req: { model?: string }, defaultModel: string): string {
  return req.model || defaultModel;
}

function resolveMaxTokens(req: { maxTokens?: number }): number {
  return req.maxTokens || DEFAULT_MAX_TOKENS;
}

function systemParam(
  systemPrompt: string | undefined,
  jobName: string | undefined,
): { system?: Anthropic.TextBlockParam[] } {
  return systemPrompt
    ? { system: buildCacheableSystem(systemPrompt, jobName) }
    : {};
}

function extractUsage(response: Anthropic.Message): TokenUsage {
  return {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}

function firstTextBlock(response: Anthropic.Message): string {
  const block = response.content[0];

  return block.type === "text" ? block.text : "";
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export function computeCost(
  model: string,
  {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
  }: TokenUsage,
): number {
  const pricing = pricingFor(model);

  return (
    inputTokens * pricing.inputPerToken +
    outputTokens * pricing.outputPerToken +
    cacheCreationTokens * pricing.inputPerToken * 1.25 +
    cacheReadTokens * pricing.inputPerToken * 0.1
  );
}

export interface AnthropicProviderOptions {
  model?: string;
  usage?: UsagePort;
}

export class AnthropicProvider implements LlmProvider {
  readonly vendor = "anthropic";

  constructor(private readonly opts: AnthropicProviderOptions = {}) {}

  private get model(): string {
    return this.opts.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  }

  /** Shared logLlmCall dispatch: no-ops without a usage sink, warns once on an uncorrelated row. */
  private async recordUsage(
    req: { taskId?: string; jobName?: string },
    payload: Parameters<UsagePort["logLlmCall"]>[0],
    warnTag: string,
  ): Promise<void> {
    if (!this.opts.usage) {
      return;
    }
    const result = await this.opts.usage.logLlmCall(payload).catch(() => null);

    if (result && !result.correlated && req.taskId) {
      console.warn(
        `[llm] ${warnTag} cost row uncorrelated: id ${req.taskId} matched no pipeline.tasks or pipeline.assembly_runs row`,
      );
    }
  }

  private async logCall(
    req: { taskId?: string; jobName?: string },
    model: string,
    { inputTokens, outputTokens, costUsd, durationMs }: LlmCallOutcome,
  ): Promise<void> {
    await this.recordUsage(
      req,
      {
        taskId: req.taskId || null,
        jobName: req.jobName || null,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      },
      "cost",
    );
  }

  private async recordFailedCall(
    req: { taskId?: string; jobName?: string },
    model: string,
    durationMs: number,
    message: string,
  ): Promise<void> {
    await this.recordUsage(
      req,
      {
        taskId: req.taskId || null,
        jobName: req.jobName || null,
        model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs,
        status: "failed",
        error: message,
      },
      "failed-call",
    );
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const model = resolveModel(req, this.model);
    const maxTokens = resolveMaxTokens(req);
    const start = Date.now();

    try {
      const client = new Anthropic();
      const prefixHash = computeCachePrefixHash(req.systemPrompt, undefined);
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...systemParam(req.systemPrompt, req.jobName),
        messages: [{ role: "user", content: req.prompt }],
      });
      const durationMs = Date.now() - start;
      const text = firstTextBlock(response);
      const {
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      } = extractUsage(response);
      const costUsd = computeCost(model, {
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      });
      const breakAnalysis = analyzeCacheBreak(
        req.jobName,
        prefixHash,
        cacheCreationTokens,
        cacheReadTokens,
      );

      await this.logCall(req, model, {
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      });
      console.log(
        `[llm] call: ${model} ${inputTokens}+${outputTokens} tokens (cache ${formatBreakLogTag(breakAnalysis)} w/r ${cacheCreationTokens}/${cacheReadTokens}) $${costUsd.toFixed(4)} ${durationMs}ms`,
      );

      return {
        text,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        costUsd,
        durationMs,
        model,
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
    const model = resolveModel(req, this.model);
    const maxTokens = resolveMaxTokens(req);
    const start = Date.now();

    try {
      const client = new Anthropic();
      const tools = buildCacheableTools(
        req.toolName,
        req.toolDescription,
        req.toolSchema as Anthropic.Tool.InputSchema,
        req.jobName,
      );
      const prefixHash = computeCachePrefixHash(
        req.systemPrompt,
        tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          input_schema: t.input_schema,
        })),
      );
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...systemParam(req.systemPrompt, req.jobName),
        messages: [{ role: "user", content: req.prompt }],
        tools,
        tool_choice: { type: "tool", name: req.toolName },
      });
      const durationMs = Date.now() - start;
      const toolUseBlock = response.content.find(
        (block) => block.type === "tool_use",
      );

      enforceTrue(
        !(!toolUseBlock || toolUseBlock.type !== "tool_use"),
        Error,
        `No tool_use block in response (stop_reason: ${response.stop_reason})`,
      );
      const parsed = toolUseBlock.input as T;
      const {
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      } = extractUsage(response);
      const costUsd = computeCost(model, {
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      });
      const breakAnalysis = analyzeCacheBreak(
        req.jobName,
        prefixHash,
        cacheCreationTokens,
        cacheReadTokens,
      );

      await this.logCall(req, model, {
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      });
      console.log(
        `[llm] tool call: ${model} ${inputTokens}+${outputTokens} tokens (cache ${formatBreakLogTag(breakAnalysis)} w/r ${cacheCreationTokens}/${cacheReadTokens}) $${costUsd.toFixed(4)} ${durationMs}ms`,
      );

      return {
        parsed,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        costUsd,
        durationMs,
        model,
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
