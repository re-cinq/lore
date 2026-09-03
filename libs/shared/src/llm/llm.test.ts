import { describe, it, expect, afterEach } from "vitest";
import { Llm } from "./llm.js";
import type { LlmProvider } from "./llm-provider.js";

/** A real (non-mock) stub provider — returns fixed values, used to prove the singleton wiring. */
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
    data: undefined as T,
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
    // Default depends on env (anthropic with a key, cli without) — the point is
    // it rebuilds a real provider, not the pinned stub.
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
