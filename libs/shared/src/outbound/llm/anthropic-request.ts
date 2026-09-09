/** Builds the Anthropic Messages request bodies (system + tool cache breakpoints included) so the provider class only orchestrates the call and its accounting. */

import type Anthropic from "@anthropic-ai/sdk";
import type { LlmToolRequest } from "./llm-provider.js";
import { getCacheControl } from "./prompt-cache.js";

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

/** The single tool this request forces, built with a cache breakpoint of its own so a schema edit busts the tool cache without touching the system cache. */
export function toolsFor(req: LlmToolRequest): Anthropic.Tool[] {
  return buildCacheableTools(
    req.toolName,
    req.toolDescription,
    req.toolSchema as Anthropic.Tool.InputSchema,
    req.jobName,
  );
}

/** The shape every completion needs before the modality-specific extras are layered on. */
interface PromptRequest {
  prompt: string;
  systemPrompt?: string;
  jobName?: string;
  maxTokens?: number;
}

export function completionParams(
  req: PromptRequest,
  model: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: resolveMaxTokens(req),
    ...systemParam(req.systemPrompt, req.jobName),
    messages: [{ role: "user", content: req.prompt }],
  };
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

export function toolCallParams(
  req: LlmToolRequest,
  model: string,
  tools: Anthropic.Tool[],
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    ...completionParams(req, model),
    tools,
    tool_choice: { type: "tool", name: req.toolName },
  };
}
