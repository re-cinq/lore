import { enforceTrue } from "../lib/enforce.js";
/**
 * Anthropic provider — the proven `callLLM`/`callLLMWithTool` logic (relocated
 * from agent/src/platform/anthropic.ts) wrapped behind {@link LlmProvider}.
 * Prompt caching, cost computation, retries and `pipeline.llm_calls` logging are
 * preserved; cost logging goes through an injected {@link UsagePort} (via
 * `Llm.configure`) so every row rides the 0032-aware routing SQL — a caller
 * passing an assembly-line id as `taskId` lands on `assembly_line_id` instead
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

// Haiku pricing: $0.80/M input, $4.00/M output. Cache writes 1.25x, reads 0.1x.
const COST_PER_INPUT_TOKEN = 0.8 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 4.0 / 1_000_000;
const COST_PER_CACHE_WRITE_TOKEN = COST_PER_INPUT_TOKEN * 1.25;
const COST_PER_CACHE_READ_TOKEN = COST_PER_INPUT_TOKEN * 0.1;

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 8192;

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
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): number {
  return (
    inputTokens * COST_PER_INPUT_TOKEN +
    outputTokens * COST_PER_OUTPUT_TOKEN +
    cacheCreationTokens * COST_PER_CACHE_WRITE_TOKEN +
    cacheReadTokens * COST_PER_CACHE_READ_TOKEN
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
        `[llm] cost row uncorrelated: id ${req.taskId} matched no pipeline.tasks or pipeline.assembly_lines row`,
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
        `[llm] failed-call cost row uncorrelated: id ${req.taskId} matched no pipeline.tasks or pipeline.assembly_lines row`,
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
