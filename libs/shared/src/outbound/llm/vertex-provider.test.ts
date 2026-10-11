import { describe, it, expect } from "vitest";
import { computeGeminiCost } from "./gemini-pricing.js";
import { VertexProvider } from "./vertex-provider.js";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function answering(text: string, captured: Captured[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    captured.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });

    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}

const signedIn = async () => ({ token: "tok", project: "my-project" });

describe("VertexProvider", () => {
  it("posts to the europe-west1 generateContent URL of my-project with a bearer token", async () => {
    const captured: Captured[] = [];
    const provider = new VertexProvider({
      model: "gemini-2.5-flash",
      region: "europe-west1",
      credentials: signedIn,
      fetchFn: answering("answer", captured),
    });

    await provider.complete({ prompt: "user-text", systemPrompt: "sys" });

    expect(captured[0]).toMatchObject({
      url: "https://europe-west1-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west1/publishers/google/models/gemini-2.5-flash:generateContent",
      headers: { Authorization: "Bearer tok" },
      body: {
        systemInstruction: { parts: [{ text: "sys" }] },
        contents: [{ role: "user", parts: [{ text: "user-text" }] }],
      },
    });
  });

  it("returns the text, 10+5 tokens and the gemini-2.5-flash price under vendor vertex", async () => {
    const provider = new VertexProvider({
      model: "gemini-2.5-flash",
      credentials: signedIn,
      fetchFn: answering("answer", []),
    });

    const result = await provider.complete({ prompt: "user-text" });

    expect(provider.vendor).toBe("vertex");
    expect(result).toMatchObject({
      text: "answer",
      model: "gemini-2.5-flash",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: computeGeminiCost("gemini-2.5-flash", 10, 5),
    });
  });

  it("parses the JSON a tool call answers with against the tool schema", async () => {
    const captured: Captured[] = [];
    const provider = new VertexProvider({
      credentials: signedIn,
      fetchFn: answering('{"pass":true}', captured),
    });
    const toolSchema = {
      type: "object",
      properties: { pass: { type: "boolean" } },
    };

    const result = await provider.completeWithTool<{ pass: boolean }>({
      prompt: "judge",
      toolName: "verdict",
      toolDescription: "The verdict",
      toolSchema,
    });

    expect(result.parsed).toEqual({ pass: true });
    expect(captured[0].body.generationConfig).toEqual({
      responseMimeType: "application/json",
      responseSchema: toolSchema,
    });
  });

  it("refuses to call Vertex with no access token, naming what is missing", async () => {
    const captured: Captured[] = [];
    const provider = new VertexProvider({
      credentials: async () => ({ token: "", project: "my-project" }),
      fetchFn: answering("answer", captured),
    });

    await expect(provider.complete({ prompt: "p" })).rejects.toThrow(
      new Error(
        "Vertex needs a Google access token: run under a workload identity or set GOOGLE_ACCESS_TOKEN",
      ),
    );
    expect(captured).toEqual([]);
  });

  it("refuses to call Vertex with no project, naming what is missing", async () => {
    const provider = new VertexProvider({
      credentials: async () => ({ token: "tok", project: "" }),
      fetchFn: answering("answer", []),
    });

    await expect(provider.complete({ prompt: "p" })).rejects.toThrow(
      new Error("Vertex needs a Google project: set GCP_PROJECT or run on GKE"),
    );
  });
});
