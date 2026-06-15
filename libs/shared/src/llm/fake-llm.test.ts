import { describe, it, expect } from "vitest";
import { FakeLlm } from "./fake-llm.js";

/** The shared real-object test double — replaces per-test vi.fn() stubs. */
describe("FakeLlm", () => {
  it("complete returns the canned text with zeroed usage", async () => {
    const result = await new FakeLlm({ text: "hello" }).complete({ prompt: "x" });
    expect(result).toMatchObject({ text: "hello", inputTokens: 0, outputTokens: 0, costUsd: 0, model: "fake" });
  });

  it("completeWithTool returns the canned data", async () => {
    const result = await new FakeLlm({ data: { matches: true } }).completeWithTool({
      prompt: "x",
      toolName: "t",
      toolDescription: "d",
      toolSchema: {},
    });
    expect(result.data).toEqual({ matches: true });
  });

  it("records the requests it received", async () => {
    const fake = new FakeLlm({ text: "ok" });
    await fake.complete({ prompt: "the-prompt", jobName: "j" });
    expect(fake.calls).toEqual([{ prompt: "the-prompt", jobName: "j" }]);
  });
});
