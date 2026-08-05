import { describe, it, expect } from "vitest";
import {
  buildCacheableSystem,
  buildCacheableTools,
  computeCost,
} from "./anthropic-provider.js";

// getCacheControl latches LORE_CACHE_1H_JOBS at module load, so these tests
// exercise the default allowlist: a 5m breakpoint ({type:"ephemeral"}) for an
// unlisted/absent job, a 1h breakpoint for a default-eligible job.

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

  it("uses the 1h breakpoint for a default-eligible job", () => {
    // getCacheControl latches LORE_CACHE_1H_JOBS at module load; an overriding
    // env would make the default-eligible 1h path unreachable, so skip rather
    // than fail spuriously (CI runs with the var unset).
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
  it("charges cache-creation tokens at 1.25x the input rate", () => {
    expect(computeCost(0, 0, 1000, 0)).toBeCloseTo(
      computeCost(1000, 0, 0, 0) * 1.25,
      12,
    );
    expect(computeCost(0, 0, 1000, 0)).toBeCloseTo(0.001, 10);
  });

  it("charges cache-read tokens at 0.1x the input rate", () => {
    expect(computeCost(0, 0, 0, 1000)).toBeCloseTo(
      computeCost(1000, 0, 0, 0) * 0.1,
      12,
    );
    expect(computeCost(0, 0, 0, 1000)).toBeCloseTo(0.00008, 10);
  });

  it("sums input, output, cache-write and cache-read for a full call", () => {
    expect(computeCost(1000, 500, 2000, 4000)).toBeCloseTo(0.00512, 8);
  });
});
