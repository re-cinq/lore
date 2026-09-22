// What a terminal `result` event says it used — tokens (prompt cache included), the model that did the work, cost and duration — across the Claude Code and Gemini shapes. The envelope and row plumbing stays in agent-events.ts.

import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";
import { computeGeminiCost } from "@re-cinq/lore-shared/llm/gemini-provider.js";

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

export interface ResultTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// Claude Code/Codex carry cumulative usage under `usage`, Gemini under `stats`; null (not zero-filled) when neither is present so the line stays skipped. Only Claude's usage names its prompt-cache reads and writes.
export function resultTokens(ev: Record<string, unknown>): ResultTokens | null {
  if (isRecord(ev.usage)) {
    return {
      inputTokens: num(ev.usage.input_tokens),
      outputTokens: num(ev.usage.output_tokens),
      cacheReadTokens: num(ev.usage.cache_read_input_tokens),
      cacheWriteTokens: num(ev.usage.cache_creation_input_tokens),
    };
  }

  if (isRecord(ev.stats)) {
    return {
      inputTokens: num(ev.stats.input_tokens),
      outputTokens: num(ev.stats.output_tokens),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  }

  return null;
}

// Primary model: the one that wrote the most output under `modelUsage` (Claude Code) or `stats.models` (Gemini). Both CLIs list their side calls there too — a classifier, a compression pass — and often first, so the first key named gemini-3-flash-preview for a review gemini-3.1-pro-preview wrote (run a8fe5dde); the sort is stable, so models reporting no output keep the CLI's order. Else flat `model`, else "unknown".
export function resultModel(ev: Record<string, unknown>): string {
  const fallback = typeof ev.model === "string" ? ev.model : "unknown";

  return (
    busiestModel(ev.modelUsage) ?? busiestModel(statsModels(ev)) ?? fallback
  );
}

function statsModels(ev: Record<string, unknown>): unknown {
  return isRecord(ev.stats) ? ev.stats.models : undefined;
}

function busiestModel(perModelUsage: unknown): string | null {
  if (!isRecord(perModelUsage)) {
    return null;
  }
  const ranked = Object.entries(perModelUsage).sort(
    ([, a], [, b]) => modelOutputTokens(b) - modelOutputTokens(a),
  );

  return ranked.at(0)?.[0] ?? null;
}

// Claude Code spells it `outputTokens`, Gemini `output_tokens`; an entry carries one or the other.
function modelOutputTokens(usage: unknown): number {
  return usageCount(usage, "outputTokens") + usageCount(usage, "output_tokens");
}

/** One count off a per-model usage entry, zero when the entry is not an object. */
function usageCount(usage: unknown, key: string): number {
  return isRecord(usage) ? num(usage[key]) : 0;
}

// Gemini reports no `total_cost_usd` (quota-based billing) so we price it from tokens; keyed on the "gemini-" model prefix since the envelope carries no vendor field.
export function resultCostUsd(
  ev: Record<string, unknown>,
  model: string,
  tokens: ResultTokens,
): number {
  if (typeof ev.total_cost_usd === "number") {
    return ev.total_cost_usd;
  }

  if (!model.startsWith("gemini-")) {
    return 0;
  }

  return (
    perModelGeminiCost(statsModels(ev)) ??
    computeGeminiCost(model, tokens.inputTokens, tokens.outputTokens)
  );
}

/** Each model at its own rate: pricing a run's every token at the primary model's rate bills a flash side call as pro. Null when the result names no models. */
function perModelGeminiCost(perModelUsage: unknown): number | null {
  if (!isRecord(perModelUsage) || Object.keys(perModelUsage).length === 0) {
    return null;
  }

  return Object.entries(perModelUsage).reduce(
    (sum, [model, usage]) =>
      sum +
      computeGeminiCost(
        model,
        usageCount(usage, "input_tokens"),
        usageCount(usage, "output_tokens"),
      ),
    0,
  );
}

// Claude Code/Codex report `duration_ms` at the top level; Gemini reports it under `stats`.
export function resultDurationMs(ev: Record<string, unknown>): number {
  if (typeof ev.duration_ms === "number") {
    return ev.duration_ms;
  }

  return isRecord(ev.stats) ? num(ev.stats.duration_ms) : 0;
}
