import Anthropic from "@anthropic-ai/sdk";
import { query } from "./db.js";

export interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
}

export interface ToolResult<T> {
  data: T;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
}

// Haiku pricing: $0.80 per million input tokens, $4.00 per million output tokens
const COST_PER_INPUT_TOKEN = 0.8 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 4.0 / 1_000_000;

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 8192;

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

  try {
    const client = new Anthropic();
    const start = Date.now();

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
      messages: [{ role: "user", content: params.prompt }],
    });

    const durationMs = Date.now() - start;

    const firstBlock = response.content[0];
    const text = firstBlock.type === "text" ? firstBlock.text : "";

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd =
      inputTokens * COST_PER_INPUT_TOKEN +
      outputTokens * COST_PER_OUTPUT_TOKEN;

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
      `[agent] LLM call: ${model} ${inputTokens}+${outputTokens} tokens $${costUsd.toFixed(4)} ${durationMs}ms`,
    );

    return { text, inputTokens, outputTokens, costUsd, durationMs, model };
  } catch (err) {
    console.error("[agent] LLM call failed:", err);
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

  try {
    const client = new Anthropic();
    const start = Date.now();

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
      messages: [{ role: "user", content: params.prompt }],
      tools: [
        {
          name: params.toolName,
          description: params.toolDescription,
          input_schema: params.toolSchema as Anthropic.Tool.InputSchema,
        },
      ],
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
    const costUsd =
      inputTokens * COST_PER_INPUT_TOKEN +
      outputTokens * COST_PER_OUTPUT_TOKEN;

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
      `[agent] LLM tool call: ${model} ${inputTokens}+${outputTokens} tokens $${costUsd.toFixed(4)} ${durationMs}ms`,
    );

    return { data, inputTokens, outputTokens, costUsd, durationMs, model };
  } catch (err) {
    console.error("[agent] LLM tool call failed:", err);
    throw err;
  }
}
