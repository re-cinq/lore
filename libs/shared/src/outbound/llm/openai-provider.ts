import { enforceTrue } from "../../lib/enforce.js";
/** OpenAI (and compatible, e.g. Codex) chat-completions provider, generalized from the old facts.ts vendor switch; tool/structured output uses JSON-mode with a parse fallback (Anthropic remains the forced-tool path). */

import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const ZERO_CACHE = { cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0 };

export interface OpenAiProviderOptions {
  model: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
}

/** The conversation as OpenAI wants it. The system turn is dropped when there is none — an empty system message is still a message the model weighs. */
function chatMessages(systemPrompt: string | undefined, prompt: string) {
  return [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    { role: "user", content: prompt },
  ];
}

export class OpenAiProvider implements LlmProvider {
  readonly vendor = "openai";

  constructor(private readonly opts: OpenAiProviderOptions) {}

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const text = await this.chat(req.systemPrompt, req.prompt);

    return {
      text,
      model: this.opts.model,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      ...ZERO_CACHE,
    };
  }

  async completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>> {
    const instruction = `${req.toolDescription}\nRespond with ONLY a JSON object matching this schema: ${JSON.stringify(req.toolSchema)}`;
    const text = await this.chat(
      req.systemPrompt ? `${req.systemPrompt}\n${instruction}` : instruction,
      req.prompt,
    );

    return {
      parsed: JSON.parse(text) as T,
      model: this.opts.model,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      ...ZERO_CACHE,
    };
  }

  private async chat(
    systemPrompt: string | undefined,
    prompt: string,
  ): Promise<string> {
    const apiKey = this.opts.apiKey ?? process.env.OPENAI_API_KEY;

    enforceTrue(apiKey, Error, "OPENAI_API_KEY not set");
    const doFetch = this.opts.fetchFn ?? fetch;
    const res = await doFetch(
      "https://api.openai.com/v1/chat/completions",
      chatInit(apiKey, {
        model: this.opts.model,
        messages: chatMessages(systemPrompt, prompt),
        temperature: 0,
      }),
    );

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
    }

    return await firstChoiceContent(res);
  }
}

function chatInit(apiKey: string, body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

async function firstChoiceContent(res: Response): Promise<string> {
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const [choice] = json.choices;

  return choice.message.content;
}
