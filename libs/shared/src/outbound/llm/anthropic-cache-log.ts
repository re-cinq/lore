/** Cache-break diagnostics for the Anthropic provider's call logging: prefix hashing + the human-readable break tag. */

import type Anthropic from "@anthropic-ai/sdk";
import {
  computeCachePrefixHash,
  type CacheBreakAnalysis,
} from "./prompt-cache.js";
import type { TokenUsage } from "./anthropic-pricing.js";

function orUnknown(value: string | number | undefined): string | number {
  return value ?? "?";
}

const TAG_BY_STATUS: Record<
  CacheBreakAnalysis["status"],
  (a: CacheBreakAnalysis) => string
> = {
  hit: () => "hit",
  "first-call": () => "first-call",
  "prompt-changed": (a) => `break:${orUnknown(a.reason)}`,
  "ttl-expired": (a) => `break:ttl(${orUnknown(a.ageMinutes)}m)`,
  "unknown-miss": () => "miss:?",
};

export function formatBreakLogTag(a: CacheBreakAnalysis): string {
  return TAG_BY_STATUS[a.status](a);
}

/** The cache prefix is system + tool schemas; hashing it is how a break is attributed to one or the other. */
export function cachePrefixHash(
  systemPrompt: string | undefined,
  tools: Anthropic.Tool[],
): ReturnType<typeof computeCachePrefixHash> {
  return computeCachePrefixHash(
    systemPrompt,
    tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.input_schema,
    })),
  );
}

export function logToolCall(call: {
  model: string;
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
  breakTag: string;
}): void {
  const { model, usage, costUsd, durationMs, breakTag } = call;

  console.log(
    `[llm] tool call: ${model} ${usage.inputTokens}+${usage.outputTokens} tokens (cache ${breakTag} w/r ${usage.cacheCreationTokens}/${usage.cacheReadTokens}) $${costUsd.toFixed(4)} ${durationMs}ms`,
  );
}
