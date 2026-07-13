import { describe, it, expect } from "vitest";
import { OllamaProvider } from "./ollama-provider.js";

describe("OllamaProvider", () => {
  it("posts a combined system+user prompt to the generate endpoint and extracts the response", async () => {
    let captured: { url: string; body: any } | null = null;
    const fetchFn = async (url: any, init: any) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ response: "ollama-answer" }), {
        status: 200,
      });
    };
    const provider = new OllamaProvider({
      model: "llama3",
      baseUrl: "http://localhost:11434",
      fetchFn: fetchFn as typeof fetch,
    });

    const result = await provider.complete({ prompt: "u", systemPrompt: "s" });

    expect(captured!.url).toBe("http://localhost:11434/api/generate");
    expect(captured!.body).toMatchObject({
      model: "llama3",
      prompt: "s\n\nu",
      stream: false,
    });
    expect(result.text).toBe("ollama-answer");
  });
});
