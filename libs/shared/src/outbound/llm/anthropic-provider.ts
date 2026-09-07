import { enforceTrue } from "../../lib/enforce.js";
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
  analyzeCacheBreak,
  computeCachePrefixHash,
} from "./prompt-cache.js";
import {
  formatBreakLogTag,
  cachePrefixHash,
  logToolCall,
} from "./anthropic-cache-log.js";

// Per-model pricing + usage/cost accounting live in anthropic-pricing.ts, re-exported for import-path back-compat.
export { computeCost, type TokenUsage } from "./anthropic-pricing.js";
import { extractUsage, computeCost } from "./anthropic-pricing.js";

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

function firstTextBlock(response: Anthropic.Message): string {
  const block = response.content[0];

  return block.type === "text" ? block.text : "";
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

  /** What every call owes regardless of shape: token usage, its cost, the persisted call record, and whether this request hit the prompt cache. The cache-break tag is computed HERE because it compares against the previous call for the same job — reading it per call site would report the wrong prefix. */
  private async account(
    req: LlmCompleteRequest | LlmToolRequest,
    model: string,
    response: Anthropic.Message,
    call: {
      start: number;
      prefixHash: ReturnType<typeof computeCachePrefixHash>;
    },
  ): Promise<{
    usage: ReturnType<typeof extractUsage>;
    costUsd: number;
    durationMs: number;
    breakTag: string;
  }> {
    const durationMs = Date.now() - call.start;
    const usage = extractUsage(response);
    const costUsd = computeCost(model, usage);

    await this.logCall(req, model, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      durationMs,
    });

    return {
      usage,
      costUsd,
      durationMs,
      breakTag: formatBreakLogTag(
        analyzeCacheBreak(
          req.jobName,
          call.prefixHash,
          usage.cacheCreationTokens,
          usage.cacheReadTokens,
        ),
      ),
    };
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
      const { usage, costUsd, durationMs, breakTag } = await this.account(
        req,
        model,
        response,
        { start, prefixHash },
      );

      console.log(
        `[llm] call: ${model} ${usage.inputTokens}+${usage.outputTokens} tokens (cache ${breakTag} w/r ${usage.cacheCreationTokens}/${usage.cacheReadTokens}) $${costUsd.toFixed(4)} ${durationMs}ms`,
      );

      return {
        text: firstTextBlock(response),
        ...usage,
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
      const tools = buildCacheableTools(
        req.toolName,
        req.toolDescription,
        req.toolSchema as Anthropic.Tool.InputSchema,
        req.jobName,
      );
      const prefixHash = cachePrefixHash(req.systemPrompt, tools);
      const response = await new Anthropic().messages.create({
        model,
        max_tokens: maxTokens,
        ...systemParam(req.systemPrompt, req.jobName),
        messages: [{ role: "user", content: req.prompt }],
        tools,
        tool_choice: { type: "tool", name: req.toolName },
      });
      const { usage, costUsd, durationMs, breakTag } = await this.account(
        req,
        model,
        response,
        { start, prefixHash },
      );

      logToolCall({ model, usage, costUsd, durationMs, breakTag });

      return {
        parsed: toolInput<T>(response),
        ...usage,
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

/** A tool call that produced no tool_use block answered something else entirely — the stop reason is the only clue, so it rides in the error. */
function toolInput<T>(response: Anthropic.Message): T {
  const block = response.content.find((b) => b.type === "tool_use");

  enforceTrue(
    block !== undefined,
    Error,
    `No tool_use block in response (stop_reason: ${response.stop_reason})`,
  );

  return block.input as T;
}
