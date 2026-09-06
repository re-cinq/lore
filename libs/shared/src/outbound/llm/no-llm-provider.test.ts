import { describe, it, expect } from "vitest";
import { NoLlmProvider } from "./no-llm-provider.js";

describe("NoLlmProvider", () => {
  const provider = new NoLlmProvider();

  it("throws on complete", async () => {
    await expect(provider.complete({ prompt: "x" })).rejects.toThrow(/no-LLM/i);
  });

  it("throws on completeWithTool", async () => {
    await expect(
      provider.completeWithTool({
        prompt: "x",
        toolName: "t",
        toolDescription: "d",
        toolSchema: {},
      }),
    ).rejects.toThrow(/no-LLM/i);
  });
});
