import { describe, it, expect } from "vitest";
import { GeminiProvider, computeGeminiCost } from "./gemini-provider.js";

/** The fetch boundary is injected (a real fn returning a real Response) — no vi.mock. */
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
    expect(result.data).toEqual({ ok: true });
    expect(result.model).toBe("gemini-2.5-pro");
  });

  it("throws a clear error instead of a JSON.parse crash when candidates carry no content", async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [] } }],
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
    ).rejects.toThrow("Gemini returned no content in candidates");
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

  it("falls back to the flash rate for an unrecognized model", () => {
    expect(computeGeminiCost("gemini-future-tier", 1000, 500)).toBeCloseTo(
      computeGeminiCost("gemini-2.5-flash", 1000, 500),
      12,
    );
  });
});
