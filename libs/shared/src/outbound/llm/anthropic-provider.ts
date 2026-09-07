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

/** What a completed call costs and how it fared against the prompt cache. */
interface CallAccounting {
  usage: ReturnType<typeof extractUsage>;
  costUsd: number;
  durationMs: number;
  breakTag: string;
}

/** How this call fared against the prompt cache, as a log tag. Compared against the LAST call for the same job, which is why it cannot be computed at a call site that sees only its own request. */
function breakTagFor(
  req: LlmCompleteRequest | LlmToolRequest,
  prefixHash: ReturnType<typeof computeCachePrefixHash>,
  usage: ReturnType<typeof extractUsage>,
): string {
  return formatBreakLogTag(
    analyzeCacheBreak(
      req.jobName,
      prefixHash,
      usage.cacheCreationTokens,
      usage.cacheReadTokens,
    ),
  );
}

/** Every result carries the same accounting tail — token counts, cost, duration, the model that actually served it — with only its payload differing. */
function withAccounting<T>(
  payload: T,
  model: string,
  { usage, costUsd, durationMs }: CallAccounting,
): T &
  ReturnType<typeof extractUsage> & {
    costUsd: number;
    durationMs: number;
    model: string;
  } {
  return { ...payload, ...usage, costUsd, durationMs, model };
}

function logCall({
  model,
  usage,
  costUsd,
  durationMs,
  breakTag,
}: CallAccounting & { model: string }): void {
  console.log(
    `[llm] call: ${model} ${usage.inputTokens}+${usage.outputTokens} tokens (cache ${breakTag} w/r ${usage.cacheCreationTokens}/${usage.cacheReadTokens}) $${costUsd.toFixed(4)} ${durationMs}ms`,
  );
}

/** The single tool this request forces, built with a cache breakpoint of its own so a schema edit busts the tool cache without touching the system cache. */
function toolsFor(req: LlmToolRequest) {
  return buildCacheableTools(
    req.toolName,
    req.toolDescription,
    req.toolSchema as Anthropic.Tool.InputSchema,
    req.jobName,
  );
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
  ): Promise<CallAccounting> {
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
      breakTag: breakTagFor(req, call.prefixHash, usage),
    };
  }

  /** Runs one API call, persisting a failed-call record before the error propagates. A call that threw still cost wall-clock time and may have burned tokens, so the ledger has to see it — the caller gets the original error either way. */
  private async recordingFailures<T>(
    req: LlmCompleteRequest | LlmToolRequest,
    { model, start, kind }: { model: string; start: number; kind: string },
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (err) {
      console.error(`[llm] ${kind} failed:`, err);
      await this.recordFailedCall(
        req,
        model,
        Date.now() - start,
        (err as Error).message,
      );
      throw err;
    }
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const model = resolveModel(req, this.model);
    const maxTokens = resolveMaxTokens(req);
    const start = Date.now();

    return this.recordingFailures(
      req,
      { model, start, kind: "call" },
      async () => {
        const prefixHash = computeCachePrefixHash(req.systemPrompt, undefined);
        const response = await new Anthropic().messages.create({
          model,
          max_tokens: maxTokens,
          ...systemParam(req.systemPrompt, req.jobName),
          messages: [{ role: "user", content: req.prompt }],
        });
        const accounting = await this.account(req, model, response, {
          start,
          prefixHash,
        });

        logCall({ model, ...accounting });

        return withAccounting(
          { text: firstTextBlock(response) },
          model,
          accounting,
        );
      },
    );
  }

  async completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>> {
    const model = resolveModel(req, this.model);
    const maxTokens = resolveMaxTokens(req);
    const start = Date.now();

    return this.recordingFailures(
      req,
      { model, start, kind: "tool call" },
      async () => {
        const tools = toolsFor(req);
        const response = await new Anthropic().messages.create({
          model,
          max_tokens: maxTokens,
          ...systemParam(req.systemPrompt, req.jobName),
          messages: [{ role: "user", content: req.prompt }],
          tools,
          tool_choice: { type: "tool", name: req.toolName },
        });
        const accounting = await this.account(req, model, response, {
          start,
          prefixHash: cachePrefixHash(req.systemPrompt, tools),
        });

        logToolCall({ model, ...accounting });

        return withAccounting(
          { parsed: toolInput<T>(response) },
          model,
          accounting,
        );
      },
    );
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
