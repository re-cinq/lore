import { describe, it, expect } from "vitest";
import {
  buildCacheableSystem,
  buildCacheableTools,
  computeCost,
} from "./anthropic-provider.js";

describe("buildCacheableSystem", () => {
  it("puts a cache_control breakpoint on the system block", () => {
    const blocks = buildCacheableSystem("You are a helpful assistant.");

    expect(blocks).toEqual([
      {
        type: "text",
        text: "You are a helpful assistant.",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("uses the 1h breakpoint for a default-eligible job when LORE_CACHE_1H_JOBS is unset (CI's baseline)", () => {
    if (process.env.LORE_CACHE_1H_JOBS !== undefined) {
      return;
    }
    const blocks = buildCacheableSystem("system prompt", "auto-curation");

    expect(blocks[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });
});

describe("buildCacheableTools", () => {
  it("puts a cache_control breakpoint on the last tool", () => {
    const tools = buildCacheableTools("extract_facts", "Extract facts", {
      type: "object",
    });

    expect(tools).toHaveLength(1);
    expect(tools[tools.length - 1]).toEqual({
      name: "extract_facts",
      description: "Extract facts",
      input_schema: { type: "object" },
      cache_control: { type: "ephemeral" },
    });
  });
});

describe("system and tools breakpoints are independent", () => {
  it("isolates each breakpoint from the other's edits", () => {
    const systemA = buildCacheableSystem("system A");
    const systemB = buildCacheableSystem("system B");
    const toolsX = buildCacheableTools("t", "description X", {
      type: "object",
    });
    const toolsY = buildCacheableTools("t", "description Y", {
      type: "object",
    });

    expect(systemA[0].cache_control).toEqual({ type: "ephemeral" });
    expect(toolsX[0].cache_control).toEqual({ type: "ephemeral" });

    expect(systemA).not.toEqual(systemB);
    expect(
      buildCacheableTools("t", "description X", { type: "object" }),
    ).toEqual(toolsX);

    expect(toolsX).not.toEqual(toolsY);
    expect(buildCacheableSystem("system A")).toEqual(systemA);
  });
});

describe("computeCost", () => {
  const HAIKU = "claude-haiku-4-5-20251001";

  it("charges cache-creation tokens at 1.25x the input rate", () => {
    expect(
      computeCost(HAIKU, {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 1000,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(
      computeCost(HAIKU, {
        inputTokens: 1000,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }) * 1.25,
      12,
    );
    expect(
      computeCost(HAIKU, {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 1000,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(0.001, 10);
  });

  it("charges cache-read tokens at 0.1x the input rate", () => {
    expect(
      computeCost(HAIKU, {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 1000,
      }),
    ).toBeCloseTo(
      computeCost(HAIKU, {
        inputTokens: 1000,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }) * 0.1,
      12,
    );
    expect(
      computeCost(HAIKU, {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 1000,
      }),
    ).toBeCloseTo(0.00008, 10);
  });

  it("sums input, output, cache-write and cache-read for a full call", () => {
    expect(
      computeCost(HAIKU, {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 2000,
        cacheReadTokens: 4000,
      }),
    ).toBeCloseTo(0.00512, 8);
  });

  it("prices a different tier at its own rate, not haiku's", () => {
    expect(
      computeCost("claude-sonnet-5", {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(2.0, 10);
    expect(
      computeCost("claude-opus-5", {
        inputTokens: 0,
        outputTokens: 1_000_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(25.0, 10);
  });

  it("prices claude-fable-5 at its own rate, not the haiku fallback", () => {
    expect(
      computeCost("claude-fable-5", {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(10.0, 10);
    expect(
      computeCost("claude-fable-5", {
        inputTokens: 0,
        outputTokens: 1_000_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(50.0, 10);
  });

  it("falls back to the haiku rate for an unrecognized model", () => {
    expect(
      computeCost("claude-some-future-tier", {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeCloseTo(
      computeCost(HAIKU, {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
      12,
    );
  });
});
