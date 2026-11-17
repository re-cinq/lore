import { describe, it, expect, afterEach } from "vitest";
import { Llm, FakeLlm } from "@re-cinq/lore-shared";
import { makeGraphLlmCall } from "./helpers.js";

const originalEnv = { ...process.env };

describe("makeGraphLlmCall", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    Llm.reset();
  });

  it("returns undefined when ANTHROPIC_API_KEY is unset", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LORE_LLM_PROVIDER;
    expect(makeGraphLlmCall(null)).toBeUndefined();
  });

  it("returns a caller when LORE_LLM_PROVIDER=openai and OPENAI_API_KEY is set without an Anthropic key", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.LORE_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "k";

    expect(makeGraphLlmCall(null)).toBeDefined();
  });

  it("routes the prompt through the Llm singleton under the graph-extraction job", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const fake = new FakeLlm({ text: "graph json" });

    Llm.setInstance(fake);
    const call = makeGraphLlmCall(null);

    expect(call).toBeDefined();
    const text = await call!("extract entities from this");

    expect(text).toBe("graph json");
    expect(fake.calls[0]).toMatchObject({
      prompt: "extract entities from this",
      jobName: "graph-extraction",
    });
  });
});
