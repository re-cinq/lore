import { describe, it, expect, afterEach } from "vitest";
import { Llm, FakeLlm } from "@re-cinq/lore-shared";
import { makeGraphLlmCall } from "./helpers.js";

// The two post-ingest producers (triggerAgentSpecTrace /
// triggerAgentSpecCoverageValidate) are covered via the routes.js re-export in
// spec-trace-trigger.test.ts and spec-coverage-validate-trigger.test.ts; this
// file covers the remaining export, the graph-extraction LLM caller.
const originalEnv = { ...process.env };

describe("makeGraphLlmCall", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    Llm.reset();
  });

  it("returns undefined when ANTHROPIC_API_KEY is unset", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(makeGraphLlmCall(null)).toBeUndefined();
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
