import { describe, it, expect } from "vitest";
import { GeminiProvider, computeGeminiCost } from "./gemini-provider.js";

describe("GeminiProvider", () => {
  it("posts systemInstruction+contents to generateContent and extracts the text", async () => {
    let captured: { url: string; body: any } | null = null;
    const fetchFn = async (url: any, init: any) => {
      captured = { url: String(url), body: JSON.parse(init.body) };

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "answer" }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
        { status: 200 },
      );
    };
    const provider = new GeminiProvider({
      model: "gemini-2.5-flash",
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
    });

    const result = await provider.complete({
      prompt: "user-text",
      systemPrompt: "sys",
    });

    expect(captured!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(captured!.body).toMatchObject({
      systemInstruction: { parts: [{ text: "sys" }] },
      contents: [{ role: "user", parts: [{ text: "user-text" }] }],
    });
    expect(result.text).toBe("answer");
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.costUsd).toBeCloseTo(
      computeGeminiCost("gemini-2.5-flash", 10, 5),
      12,
    );
  });

  it("requests JSON structured output for completeWithTool and parses it", async () => {
    let captured: { body: any } | null = null;
    const fetchFn = async (_url: any, init: any) => {
      captured = { body: JSON.parse(init.body) };

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
        }),
        { status: 200 },
      );
    };
    const provider = new GeminiProvider({
      model: "gemini-2.5-pro",
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
    });

    const result = await provider.completeWithTool<{ ok: boolean }>({
      prompt: "extract",
      toolName: "extract_facts",
      toolDescription: "Extract facts",
      toolSchema: { type: "object", properties: { ok: { type: "boolean" } } },
    });

    expect(captured!.body.generationConfig).toEqual({
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
      },
    });
    expect(result.parsed).toEqual({ ok: true });
    expect(result.model).toBe("gemini-2.5-pro");
  });

  it("sends temperature 0 in generationConfig for a plain call and beside the schema for a tool call", async () => {
    const bodies: any[] = [];
    const fetchFn = async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        }),
        { status: 200 },
      );
    };
    const provider = new GeminiProvider({
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
    });
    const toolSchema = { type: "object" };

    await provider.complete({ prompt: "p", temperature: 0 });
    await provider.completeWithTool({
      prompt: "p",
      temperature: 0,
      toolName: "t",
      toolDescription: "d",
      toolSchema,
    });

    expect(bodies.map((body) => body.generationConfig)).toEqual([
      { temperature: 0 },
      {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: toolSchema,
      },
    ]);
  });

  it("caps a gemini-2.5-flash call at 2000 output tokens through maxOutputTokens and sets no thinking level", async () => {
    let body: any;
    const fetchFn = async (_url: any, init: any) => {
      body = JSON.parse(init.body);

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        }),
        { status: 200 },
      );
    };
    const provider = new GeminiProvider({
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
    });

    await provider.complete({ prompt: "p", maxTokens: 2000 });

    expect(body.generationConfig).toEqual({ maxOutputTokens: 2000 });
  });

  it("asks gemini-3-flash-preview for the low thinking level, since its default is dynamic reasoning", async () => {
    let body: any;
    const fetchFn = async (_url: any, init: any) => {
      body = JSON.parse(init.body);

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        }),
        { status: 200 },
      );
    };
    const provider = new GeminiProvider({
      apiKey: "k",
      model: "gemini-3-flash-preview",
      fetchFn: fetchFn as typeof fetch,
    });

    await provider.complete({ prompt: "p" });

    expect(body.generationConfig).toEqual({
      thinkingConfig: { thinkingLevel: "low" },
    });
  });

  it("sends no generationConfig for a plain call that names no temperature", async () => {
    const bodies: any[] = [];
    const fetchFn = async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        }),
        { status: 200 },
      );
    };
    const provider = new GeminiProvider({
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
    });

    await provider.complete({ prompt: "p" });

    expect(bodies[0]).not.toHaveProperty("generationConfig");
  });

  it("throws naming MAX_TOKENS instead of a JSON.parse crash when the candidate carries no text", async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 0 },
        }),
        { status: 200 },
      );
    const provider = new GeminiProvider({
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
    });

    await expect(
      provider.completeWithTool({
        prompt: "extract",
        toolName: "extract_facts",
        toolDescription: "Extract facts",
        toolSchema: { type: "object" },
      }),
    ).rejects.toThrow("Gemini returned no text (MAX_TOKENS)");
  });

  it("throws naming the block reason on a plain call answered with no candidate, instead of an empty string", async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }),
        { status: 200 },
      );
    const provider = new GeminiProvider({
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
    });

    await expect(provider.complete({ prompt: "x" })).rejects.toThrow(
      "Gemini returned no text (SAFETY)",
    );
  });

  it("sends a 90 s abort signal by default and the configured 50 ms one, failing a call that never answers", async () => {
    const signals: AbortSignal[] = [];
    const fetchFn = async (_url: any, init: any) => {
      signals.push(init.signal);

      return new Promise<Response>((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    };
    const provider = new GeminiProvider({
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
      timeoutMs: 50,
    });

    await expect(provider.complete({ prompt: "x" })).rejects.toThrow(
      /timeout|timed out/i,
    );
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("throws with the status text on a non-ok response", async () => {
    const fetchFn = async () =>
      new Response("nope", { status: 500, statusText: "Server Error" });
    const provider = new GeminiProvider({
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
    });

    await expect(provider.complete({ prompt: "x" })).rejects.toThrow(
      "Gemini API error: 500 Server Error",
    );
  });
});

describe("computeGeminiCost", () => {
  it("prices a recognized model from its own per-1M rate", () => {
    expect(computeGeminiCost("gemini-2.5-flash", 1_000_000, 0)).toBeCloseTo(
      0.3,
      10,
    );
    expect(computeGeminiCost("gemini-2.5-flash", 0, 1_000_000)).toBeCloseTo(
      2.5,
      10,
    );
    expect(
      computeGeminiCost("gemini-2.5-pro", 1_000_000, 1_000_000),
    ).toBeCloseTo(1.25 + 10.0, 10);
  });

  it("prices the Gemini 3-series models from their own per-1M rates", () => {
    expect(
      computeGeminiCost("gemini-3.1-pro-preview", 1_000_000, 1_000_000),
    ).toBeCloseTo(2.0 + 12.0, 6);
    expect(
      computeGeminiCost("gemini-3.7-flash", 1_000_000, 1_000_000),
    ).toBeCloseTo(0.75 + 3.75, 6);
    expect(
      computeGeminiCost("gemini-3.1-flash-lite", 1_000_000, 1_000_000),
    ).toBeCloseTo(0.25 + 1.5, 6);
  });

  it("prices gemini-3-flash-preview at $0.50 in and $3.00 out per 1M tokens", () => {
    expect(
      computeGeminiCost("gemini-3-flash-preview", 1_000_000, 1_000_000),
    ).toBeCloseTo(0.5 + 3.0, 6);
  });

  it("falls back to the flash rate for an unrecognized model", () => {
    expect(computeGeminiCost("gemini-future-tier", 1000, 500)).toBeCloseTo(
      computeGeminiCost("gemini-2.5-flash", 1000, 500),
      12,
    );
  });
});
