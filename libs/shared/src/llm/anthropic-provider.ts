import { enforceTrue } from "../lib/enforce.js";
/**
 * Anthropic provider — the proven `callLLM`/`callLLMWithTool` logic (relocated
 * from agent/src/platform/anthropic.ts) wrapped behind {@link LlmProvider}.
 * Prompt caching, cost computation, retries and `pipeline.llm_calls` logging are
 * preserved; cost logging goes through an injected {@link UsagePort} (via
 * `Llm.configure`) so every row rides the 0032-aware routing SQL — a caller
 * passing an assembly-line id as `taskId` lands on `assembly_run_id` instead
 * of being FK-rejected. Port absent → logging is skipped.
 */

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

interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 8192;

// $/token, derived from the published $/1M rates. Cache writes are always
// 1.25x the input rate and cache reads 0.1x, regardless of tier — Anthropic
// prices caching as a multiplier on whichever model served the call.
// Reverify against shared/live-sources.md -> Pricing when adding a new tier;
// these numbers drift.
const MODEL_PRICING: Record<string, ModelPricing> = {
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

// An unrecognized model (a new tier not yet added above, or a dated snapshot
// id) still needs an approximate cost rather than a thrown error — the
// cheapest current tier is the least-wrong default for logging purposes.
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

function formatBreakLogTag(a: CacheBreakAnalysis): string {
  switch (a.status) {
    case "hit":
      return "hit";
    case "first-call":
      return "first-call";
    case "prompt-changed":
      return `break:${a.reason ?? "?"}`;
    case "ttl-expired":
      return `break:ttl(${a.ageMinutes ?? "?"}m)`;
    case "unknown-miss":
      return "miss:?";
  }
}

export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
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
    const result = await this.opts.usage
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

    if (result && !result.correlated && req.taskId) {
      console.warn(
        `[llm] failed-call cost row uncorrelated: id ${req.taskId} matched no pipeline.tasks or pipeline.assembly_runs row`,
      );
    }
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const model = req.model || this.model;
    const maxTokens = req.maxTokens || DEFAULT_MAX_TOKENS;
    const start = Date.now();

    try {
      const client = new Anthropic();
      const prefixHash = computeCachePrefixHash(req.systemPrompt, undefined);
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(req.systemPrompt
          ? { system: buildCacheableSystem(req.systemPrompt, req.jobName) }
          : {}),
        messages: [{ role: "user", content: req.prompt }],
      });
      const durationMs = Date.now() - start;
      const firstBlock = response.content[0];
      const text = firstBlock.type === "text" ? firstBlock.text : "";
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const cacheCreationTokens =
        response.usage.cache_creation_input_tokens ?? 0;
      const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;
      const costUsd = computeCost(
        model,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      );
      const breakAnalysis = analyzeCacheBreak(
        req.jobName,
        prefixHash,
        cacheCreationTokens,
        cacheReadTokens,
      );

      await this.logCall(
        req,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      );
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
    const model = req.model || this.model;
    const maxTokens = req.maxTokens || DEFAULT_MAX_TOKENS;
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
        ...(req.systemPrompt
          ? { system: buildCacheableSystem(req.systemPrompt, req.jobName) }
          : {}),
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
      const data = toolUseBlock.input as T;
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const cacheCreationTokens =
        response.usage.cache_creation_input_tokens ?? 0;
      const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;
      const costUsd = computeCost(
        model,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      );
      const breakAnalysis = analyzeCacheBreak(
        req.jobName,
        prefixHash,
        cacheCreationTokens,
        cacheReadTokens,
      );

      await this.logCall(
        req,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      );
      console.log(
        `[llm] tool call: ${model} ${inputTokens}+${outputTokens} tokens (cache ${formatBreakLogTag(breakAnalysis)} w/r ${cacheCreationTokens}/${cacheReadTokens}) $${costUsd.toFixed(4)} ${durationMs}ms`,
      );

      return {
        data,
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
