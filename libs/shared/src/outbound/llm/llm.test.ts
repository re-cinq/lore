import { describe, it, expect, afterEach } from "vitest";
import { Llm } from "./llm.js";
import type { LlmProvider } from "./llm-provider.js";

const stub: LlmProvider = {
  vendor: "stub",
  complete: async () => ({
    text: "stub",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    durationMs: 0,
    model: "stub",
  }),
  completeWithTool: async <T>() => ({
    parsed: undefined as T,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    durationMs: 0,
    model: "stub",
  }),
};

describe("Llm singleton", () => {
  afterEach(() => Llm.reset());

  it("returns the provider installed via setInstance", () => {
    Llm.setInstance(stub);
    expect(Llm.instance).toBe(stub);
  });

  it("rebuilds the env-resolved default after reset (no provider pinned)", () => {
    Llm.setInstance(stub);
    Llm.reset();
    expect(["anthropic", "cli"]).toContain(Llm.instance.vendor);
  });

  it("reports usageConfigured true after configure with a port and false after clearing", () => {
    expect(Llm.usageConfigured).toBe(false);

    Llm.configure({
      usage: {
        logLlmCall: async () => ({ correlated: true }),
        processedCounts: async () => ({ today: 0, total: 0 }),
        modelsUsed: async () => [],
      },
    });
    expect(Llm.usageConfigured).toBe(true);

    Llm.configure({});
    expect(Llm.usageConfigured).toBe(false);
  });
});

describe("Llm.for", () => {
  afterEach(() => {
    delete process.env.LORE_EVAL_LLM_PROVIDER;
    Llm.reset();
  });

  it("returns the process-wide provider for the eval use when LORE_EVAL_LLM_PROVIDER is unset", () => {
    Llm.setInstance(stub);

    expect(Llm.for("eval")).toBe(stub);
  });

  it("returns a vertex provider for the eval use when LORE_EVAL_LLM_PROVIDER=vertex, and keeps the process-wide one", () => {
    process.env.LORE_EVAL_LLM_PROVIDER = "vertex";
    Llm.setInstance(stub);

    expect(Llm.for("eval").vendor).toBe("vertex");
    expect(Llm.instance).toBe(stub);
  });

  it("hands back the same vertex provider on a second ask for the eval use", () => {
    process.env.LORE_EVAL_LLM_PROVIDER = "vertex";

    expect(Llm.for("eval")).toBe(Llm.for("eval"));
  });
});
