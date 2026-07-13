import { describe, it, expect } from "vitest";
import { OpenAiProvider } from "./openai-provider.js";

/** The fetch boundary is injected (a real fn returning a real Response) — no vi.mock. */
describe("OpenAiProvider", () => {
  it("posts system+user messages to the chat-completions endpoint and extracts the content", async () => {
    let captured: { url: string; body: any } | null = null;
    const fetchFn = async (url: any, init: any) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
        { status: 200 },
      );
    };
    const provider = new OpenAiProvider({
      model: "gpt-4o-mini",
      apiKey: "k",
      fetchFn: fetchFn as typeof fetch,
    });

    const result = await provider.complete({
      prompt: "user-text",
      systemPrompt: "sys",
    });

    expect(captured!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured!.body).toMatchObject({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "user-text" },
      ],
      temperature: 0,
    });
    expect(result.text).toBe("answer");
    expect(result.model).toBe("gpt-4o-mini");
  });
});
