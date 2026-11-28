import { describe, it, expect } from "vitest";
import { OpenAiProvider } from "./openai-provider.js";
import type { LlmCallRecord, UsagePort } from "../project/usage/usage-port.js";

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function recordingFetch(
  reply: unknown,
  status = 200,
): { fetchFn: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });

    return new Response(JSON.stringify(reply), {
      status,
      statusText: status === 200 ? "OK" : "Unauthorized",
    });
  };

  return { fetchFn: fetchFn as typeof fetch, requests };
}

function chatReply(message: Record<string, unknown>, finishReason = "stop") {
  return {
    choices: [{ message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 6 },
    },
  };
}

function recordingUsage(): { usage: UsagePort; rows: LlmCallRecord[] } {
  const rows: LlmCallRecord[] = [];
  const usage: UsagePort = {
    logLlmCall: async (record) => {
      rows.push(record);

      return { correlated: true };
    },
    processedCounts: async () => ({ today: 0, total: 0 }),
    modelsUsed: async () => [],
  };

  return { usage, rows };
}

const BASE_URL = "https://res.openai.azure.com/openai/v1";

describe("OpenAiProvider", () => {
  it("posts model gpt-5-mini and system plus user messages to /chat/completions with a bearer key and returns the reply text", async () => {
    const { fetchFn, requests } = recordingFetch(
      chatReply({ content: "answer" }),
    );
    const provider = new OpenAiProvider({
      model: "gpt-5-mini",
      apiKey: "k1",
      baseUrl: BASE_URL,
      fetchFn,
    });

    const result = await provider.complete({
      prompt: "user-text",
      systemPrompt: "sys",
      maxTokens: 200,
      temperature: 0,
    });

    expect(requests).toEqual([
      {
        url: `${BASE_URL}/chat/completions`,
        headers: {
          Authorization: "Bearer k1",
          "Content-Type": "application/json",
        },
        body: {
          model: "gpt-5-mini",
          messages: [
            { role: "system", content: "sys" },
            { role: "user", content: "user-text" },
          ],
          max_completion_tokens: 200,
        },
      },
    ]);
    expect(result).toMatchObject({
      text: "answer",
      model: "gpt-5-mini",
      inputTokens: 11,
      outputTokens: 4,
      cacheReadTokens: 6,
      cacheCreationTokens: 0,
      costUsd: 0,
    });
  });

  it("sends only the user message and no token cap when there is no system prompt or maxTokens", async () => {
    const { fetchFn, requests } = recordingFetch(
      chatReply({ content: "answer" }),
    );
    const provider = new OpenAiProvider({ model: "m", apiKey: "k", fetchFn });

    await provider.complete({ prompt: "u" });

    expect(requests[0].body).toEqual({
      model: "m",
      messages: [{ role: "user", content: "u" }],
    });
  });

  it("strips a trailing slash from the base URL and defaults to api.openai.com", async () => {
    const withSlash = recordingFetch(chatReply({ content: "a" }));
    const withDefault = recordingFetch(chatReply({ content: "a" }));

    await new OpenAiProvider({
      model: "m",
      apiKey: "k",
      baseUrl: `${BASE_URL}/`,
      fetchFn: withSlash.fetchFn,
    }).complete({ prompt: "u" });
    await new OpenAiProvider({
      model: "m",
      apiKey: "k",
      fetchFn: withDefault.fetchFn,
    }).complete({ prompt: "u" });

    expect([withSlash.requests[0].url, withDefault.requests[0].url]).toEqual([
      `${BASE_URL}/chat/completions`,
      "https://api.openai.com/v1/chat/completions",
    ]);
  });

  it("prefers the request model over the provider model", async () => {
    const { fetchFn, requests } = recordingFetch(chatReply({ content: "a" }));
    const provider = new OpenAiProvider({
      model: "provider-model",
      apiKey: "k",
      fetchFn,
    });

    await provider.complete({ prompt: "u", model: "request-model" });

    expect(requests[0].body.model).toBe("request-model");
  });

  it("rejects naming LORE_FACT_MODEL when neither the request nor the provider has a model", async () => {
    const { fetchFn, requests } = recordingFetch(chatReply({ content: "a" }));
    const provider = new OpenAiProvider({ apiKey: "k", fetchFn });

    await expect(provider.complete({ prompt: "u" })).rejects.toThrow(
      new Error(
        "OpenAI-compatible model not set: set LORE_FACT_MODEL to the model or deployment name",
      ),
    );
    expect(requests).toEqual([]);
  });

  it("rejects naming OPENAI_API_KEY when no key is set", async () => {
    const { fetchFn } = recordingFetch(chatReply({ content: "a" }));
    const provider = new OpenAiProvider({ model: "m", fetchFn });

    await expect(provider.complete({ prompt: "u" })).rejects.toThrow(
      new Error("OPENAI_API_KEY not set"),
    );
  });

  it("rejects naming the finish reason when the reply has no text", async () => {
    const { fetchFn } = recordingFetch(
      chatReply({ content: null }, "content_filter"),
    );
    const provider = new OpenAiProvider({ model: "m", apiKey: "k", fetchFn });

    await expect(provider.complete({ prompt: "u" })).rejects.toThrow(
      new Error("OpenAI returned no text (content_filter)"),
    );
  });

  it("rejects with status and status text on a non-ok reply", async () => {
    const { fetchFn } = recordingFetch({ error: "bad key" }, 401);
    const provider = new OpenAiProvider({ model: "m", apiKey: "k", fetchFn });

    await expect(provider.complete({ prompt: "u" })).rejects.toThrow(
      new Error("OpenAI API error: 401 Unauthorized"),
    );
  });

  it("forces the named function tool and parses its arguments for completeWithTool", async () => {
    const toolSchema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
    };
    const { fetchFn, requests } = recordingFetch(
      chatReply({
        content: null,
        tool_calls: [
          {
            type: "function",
            function: { name: "emit", arguments: '{"ok":true}' },
          },
        ],
      }),
    );
    const provider = new OpenAiProvider({ model: "m", apiKey: "k", fetchFn });

    const result = await provider.completeWithTool<{ ok: boolean }>({
      prompt: "u",
      toolName: "emit",
      toolDescription: "emit the result",
      toolSchema,
    });

    expect(requests[0].body).toMatchObject({
      tools: [
        {
          type: "function",
          function: {
            name: "emit",
            description: "emit the result",
            parameters: toolSchema,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "emit" } },
    });
    expect(result).toMatchObject({
      parsed: { ok: true },
      inputTokens: 11,
      outputTokens: 4,
    });
  });

  it("rejects completeWithTool when the reply holds no tool call", async () => {
    const { fetchFn } = recordingFetch(chatReply({ content: "prose" }));
    const provider = new OpenAiProvider({ model: "m", apiKey: "k", fetchFn });

    await expect(
      provider.completeWithTool({
        prompt: "u",
        toolName: "emit",
        toolDescription: "d",
        toolSchema: {},
      }),
    ).rejects.toThrow(new Error("OpenAI returned no tool call (stop)"));
  });

  it("writes a success usage row with real tokens and zero cost", async () => {
    const { fetchFn } = recordingFetch(chatReply({ content: "a" }));
    const { usage, rows } = recordingUsage();
    const provider = new OpenAiProvider({
      model: "m",
      apiKey: "k",
      usage,
      fetchFn,
    });

    await provider.complete({ prompt: "u", taskId: "t1", jobName: "job" });

    expect(rows).toMatchObject([
      {
        taskId: "t1",
        jobName: "job",
        model: "m",
        inputTokens: 11,
        outputTokens: 4,
        cacheReadTokens: 6,
        costUsd: 0,
      },
    ]);
  });

  it("writes a failed usage row and rethrows on a non-ok reply", async () => {
    const { fetchFn } = recordingFetch({}, 401);
    const { usage, rows } = recordingUsage();
    const provider = new OpenAiProvider({
      model: "m",
      apiKey: "k",
      usage,
      fetchFn,
    });

    await expect(provider.complete({ prompt: "u" })).rejects.toThrow(
      "OpenAI API error: 401 Unauthorized",
    );
    expect(rows).toMatchObject([
      {
        model: "m",
        status: "failed",
        error: "OpenAI API error: 401 Unauthorized",
      },
    ]);
  });

  it("posts the same URL and body with the key only in x-api-key when built with authHeader x-api-key", async () => {
    const { fetchFn, requests } = recordingFetch(
      chatReply({ content: "answer" }),
    );
    const provider = new OpenAiProvider({
      model: "gpt-5-mini",
      apiKey: "dummy-key",
      baseUrl: BASE_URL,
      authHeader: "x-api-key",
      fetchFn,
    });

    const result = await provider.complete({ prompt: "user-text" });

    expect(requests).toEqual([
      {
        url: `${BASE_URL}/chat/completions`,
        headers: {
          "x-api-key": "dummy-key",
          "Content-Type": "application/json",
        },
        body: {
          model: "gpt-5-mini",
          messages: [{ role: "user", content: "user-text" }],
        },
      },
    ]);
    expect(result).toMatchObject({ text: "answer", inputTokens: 11 });
  });

  it("sends the key only in x-api-key on the forced tool call of completeWithTool when built with authHeader x-api-key", async () => {
    const { fetchFn, requests } = recordingFetch(
      chatReply({
        content: null,
        tool_calls: [
          {
            type: "function",
            function: { name: "emit", arguments: '{"ok":true}' },
          },
        ],
      }),
    );
    const provider = new OpenAiProvider({
      model: "m",
      apiKey: "dummy-key",
      authHeader: "x-api-key",
      fetchFn,
    });

    const result = await provider.completeWithTool<{ ok: boolean }>({
      prompt: "u",
      toolName: "emit",
      toolDescription: "emit the result",
      toolSchema: {},
    });

    expect(requests[0].headers).toEqual({
      "x-api-key": "dummy-key",
      "Content-Type": "application/json",
    });
    expect(result.parsed).toEqual({ ok: true });
  });
});
