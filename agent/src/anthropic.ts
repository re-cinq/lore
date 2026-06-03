import Anthropic from "@anthropic-ai/sdk";
import { query } from "./db.js";
import {
  getCacheControl,
  computeCachePrefixHash,
  analyzeCacheBreak,
  type CacheBreakAnalysis,
} from "./lib/prompt-cache.js";

export interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
}

export interface ToolResult<T> {
  data: T;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
}

// Haiku pricing: $0.80 per million input tokens, $4.00 per million output tokens.
// Cache writes: 1.25x input. Cache reads: 0.1x input.
const COST_PER_INPUT_TOKEN = 0.8 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 4.0 / 1_000_000;
const COST_PER_CACHE_WRITE_TOKEN = COST_PER_INPUT_TOKEN * 1.25;
const COST_PER_CACHE_READ_TOKEN = COST_PER_INPUT_TOKEN * 0.1;

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 8192;

// Below these thresholds Anthropic does not cache. We don't enforce
// them — the API silently skips caching if under — but they document
// the break-even point.
// - sonnet/opus: 1024 tokens
// - haiku: 2048 tokens

/**
 * Build a cacheable system block from a system prompt string. The whole
 * system prompt becomes one text block tagged with an ephemeral cache
 * breakpoint so identical system prompts across calls hit the cache.
 * TTL (5m vs 1h) varies per job — see lib/prompt-cache.
 */
function buildCacheableSystem(
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

/**
 * Build a tool definition with cache_control attached to the last tool.
 * Enables a second cache breakpoint so tool schemas are cached separately
 * from the system block — tool breaks alone won't bust the system cache.
 */
function buildCacheableTools(
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
    case "hit":            return "hit";
    case "first-call":     return "first-call";
    case "prompt-changed": return `break:${a.reason ?? "?"}`;
    case "ttl-expired":    return `break:ttl(${a.ageMinutes ?? "?"}m)`;
    case "unknown-miss":   return "miss:?";
  }
}

function computeCost(
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

/**
 * Record a failed LLM call so it surfaces in the task's LLM Calls table
 * instead of vanishing into pod stdout. Best-effort — never let the logging
 * insert mask the original API error.
 */
async function recordFailedCall(
  taskId: string | undefined,
  jobName: string | undefined,
  model: string,
  durationMs: number,
  message: string,
): Promise<void> {
  await query(
    `INSERT INTO pipeline.llm_calls
       (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms, status, error)
     VALUES ($1, $2, $3, 0, 0, 0, $4, 'failed', $5)`,
    [taskId || null, jobName || null, model, durationMs, message],
  ).catch(() => {});
}

export async function callLLM(params: {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  taskId?: string;
  jobName?: string;
}): Promise<LLMResult> {
  const model = params.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const maxTokens = params.maxTokens || DEFAULT_MAX_TOKENS;
  const start = Date.now();

  try {
    const client = new Anthropic();

    const prefixHash = computeCachePrefixHash(params.systemPrompt, undefined);

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(params.systemPrompt
        ? { system: buildCacheableSystem(params.systemPrompt, params.jobName) }
        : {}),
      messages: [{ role: "user", content: params.prompt }],
    });

    const durationMs = Date.now() - start;

    const firstBlock = response.content[0];
    const text = firstBlock.type === "text" ? firstBlock.text : "";

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;
    const costUsd = computeCost(
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    );
    const breakAnalysis = analyzeCacheBreak(
      params.jobName,
      prefixHash,
      cacheCreationTokens,
      cacheReadTokens,
    );

    // Log to pipeline.llm_calls
    await query(
      `INSERT INTO pipeline.llm_calls
         (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.taskId || null,
        params.jobName || null,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      ],
    );

    console.log(
      `[agent] LLM call: ${model} ${inputTokens}+${outputTokens} tokens (cache ${formatBreakLogTag(breakAnalysis)} w/r ${cacheCreationTokens}/${cacheReadTokens}) $${costUsd.toFixed(4)} ${durationMs}ms`,
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
    console.error("[agent] LLM call failed:", err);
    await recordFailedCall(
      params.taskId,
      params.jobName,
      model,
      Date.now() - start,
      (err as Error).message,
    );
    throw err;
  }
}

export async function callLLMWithTool<T>(params: {
  prompt: string;
  systemPrompt?: string;
  toolName: string;
  toolDescription: string;
  toolSchema: Record<string, any>;
  model?: string;
  maxTokens?: number;
  taskId?: string;
  jobName?: string;
}): Promise<ToolResult<T>> {
  const model = params.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const maxTokens = params.maxTokens || DEFAULT_MAX_TOKENS;
  const start = Date.now();

  try {
    const client = new Anthropic();

    const tools = buildCacheableTools(
      params.toolName,
      params.toolDescription,
      params.toolSchema as Anthropic.Tool.InputSchema,
      params.jobName,
    );
    const prefixHash = computeCachePrefixHash(
      params.systemPrompt,
      tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.input_schema,
      })),
    );

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(params.systemPrompt
        ? { system: buildCacheableSystem(params.systemPrompt, params.jobName) }
        : {}),
      messages: [{ role: "user", content: params.prompt }],
      tools,
      tool_choice: { type: "tool", name: params.toolName },
    });

    const durationMs = Date.now() - start;

    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use",
    );
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      throw new Error(
        `No tool_use block in response (stop_reason: ${response.stop_reason})`,
      );
    }

    const data = toolUseBlock.input as T;

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;
    const costUsd = computeCost(
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    );
    const breakAnalysis = analyzeCacheBreak(
      params.jobName,
      prefixHash,
      cacheCreationTokens,
      cacheReadTokens,
    );

    // Log to pipeline.llm_calls
    await query(
      `INSERT INTO pipeline.llm_calls
         (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.taskId || null,
        params.jobName || null,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
      ],
    );

    console.log(
      `[agent] LLM tool call: ${model} ${inputTokens}+${outputTokens} tokens (cache ${formatBreakLogTag(breakAnalysis)} w/r ${cacheCreationTokens}/${cacheReadTokens}) $${costUsd.toFixed(4)} ${durationMs}ms`,
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
    console.error("[agent] LLM tool call failed:", err);
    await recordFailedCall(
      params.taskId,
      params.jobName,
      model,
      Date.now() - start,
      (err as Error).message,
    );
    throw err;
  }
}
