import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  djb2Hash,
  computeCachePrefixHash,
  analyzeCacheBreak,
  __resetCacheStateForTests,
} from "./prompt-cache.js";

// Note: `shouldUse1hTTL` / `getCacheControl` latch on LORE_CACHE_1H_JOBS
// at module load time. Changing process.env here doesn't affect them
// because the module is already imported. We rely on defaults instead
// and cover parsing logic by exercising the public API's observable
// behavior (1h for auto-curation, 5m for an unknown job).

import { shouldUse1hTTL, getCacheControl } from "./prompt-cache.js";

describe("djb2Hash", () => {
  it("is deterministic across runs", () => {
    expect(djb2Hash("hello world")).toBe(djb2Hash("hello world"));
  });

  it("produces different hashes for different inputs", () => {
    expect(djb2Hash("a")).not.toBe(djb2Hash("b"));
  });

  it("handles empty string", () => {
    const h = djb2Hash("");
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(0);
  });

  it("is case-sensitive", () => {
    expect(djb2Hash("Hello")).not.toBe(djb2Hash("hello"));
  });
});

describe("computeCachePrefixHash", () => {
  it("returns empty strings when no system/tools", () => {
    const h = computeCachePrefixHash(undefined, undefined);
    expect(h).toEqual({ system: "", tools: "" });
  });

  it("hashes only system when tools are absent", () => {
    const h = computeCachePrefixHash("You are a helpful assistant.", undefined);
    expect(h.system).not.toBe("");
    expect(h.tools).toBe("");
  });

  it("produces matching hashes for identical inputs", () => {
    const tools = [{ name: "f", description: "d", input_schema: { type: "object" } }];
    const a = computeCachePrefixHash("sys", tools);
    const b = computeCachePrefixHash("sys", tools);
    expect(a).toEqual(b);
  });

  it("differs when tool description changes", () => {
    const a = computeCachePrefixHash("sys", [
      { name: "f", description: "v1", input_schema: {} },
    ]);
    const b = computeCachePrefixHash("sys", [
      { name: "f", description: "v2", input_schema: {} },
    ]);
    expect(a.system).toBe(b.system);
    expect(a.tools).not.toBe(b.tools);
  });
});

describe("shouldUse1hTTL", () => {
  it("is true for default-allowlisted jobs", () => {
    expect(shouldUse1hTTL("auto-curation")).toBe(true);
    expect(shouldUse1hTTL("review_reactor")).toBe(true);
    expect(shouldUse1hTTL("fact-extraction")).toBe(true);
  });

  it("is false for unknown jobs", () => {
    expect(shouldUse1hTTL("consolidation")).toBe(false);
    expect(shouldUse1hTTL("some-random-job")).toBe(false);
  });

  it("is false when jobName is undefined", () => {
    expect(shouldUse1hTTL(undefined)).toBe(false);
  });
});

describe("getCacheControl", () => {
  it("returns {type:ephemeral, ttl:1h} for eligible jobs", () => {
    expect(getCacheControl("auto-curation")).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("returns {type:ephemeral} (no ttl) for ineligible jobs", () => {
    expect(getCacheControl("consolidation")).toEqual({ type: "ephemeral" });
  });

  it("returns {type:ephemeral} (no ttl) when jobName missing", () => {
    expect(getCacheControl()).toEqual({ type: "ephemeral" });
  });
});

describe("analyzeCacheBreak", () => {
  const jobName = "test-job";
  const hashA = { system: "sys-a", tools: "tool-a" };
  const hashB = { system: "sys-b", tools: "tool-a" };
  const hashC = { system: "sys-a", tools: "tool-c" };

  beforeEach(() => {
    __resetCacheStateForTests();
  });

  afterEach(() => {
    __resetCacheStateForTests();
  });

  it("classifies the first call as first-call", () => {
    const r = analyzeCacheBreak(jobName, hashA, 100, 0);
    expect(r.status).toBe("first-call");
  });

  it("classifies a cache read as hit", () => {
    // seed state first
    analyzeCacheBreak(jobName, hashA, 100, 0);
    // then a hit
    const r = analyzeCacheBreak(jobName, hashA, 0, 100);
    expect(r.status).toBe("hit");
  });

  it("classifies system-only prompt change", () => {
    analyzeCacheBreak(jobName, hashA, 100, 0);
    const r = analyzeCacheBreak(jobName, hashB, 100, 0);
    expect(r.status).toBe("prompt-changed");
    expect(r.reason).toBe("system");
  });

  it("classifies tools-only change", () => {
    analyzeCacheBreak(jobName, hashA, 100, 0);
    const r = analyzeCacheBreak(jobName, hashC, 100, 0);
    expect(r.status).toBe("prompt-changed");
    expect(r.reason).toBe("tools");
  });

  it("classifies ttl-expired when hashes match but no read", () => {
    analyzeCacheBreak(jobName, hashA, 100, 0);
    // Second call: same hash, paid to write again → TTL expired
    const r = analyzeCacheBreak(jobName, hashA, 100, 0);
    expect(r.status).toBe("ttl-expired");
    expect(typeof r.ageMinutes).toBe("number");
  });

  it("tracks state independently per jobName", () => {
    analyzeCacheBreak("job-1", hashA, 100, 0);
    // Different job starts fresh
    const r = analyzeCacheBreak("job-2", hashA, 100, 0);
    expect(r.status).toBe("first-call");
  });
});
