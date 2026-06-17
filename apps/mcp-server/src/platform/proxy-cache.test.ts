import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildKey,
  isCacheEnabled,
  readFresh,
  readAny,
  store,
  invalidate,
  markFresh,
  markStale,
  type ReadCachePolicy,
} from "./proxy-cache.js";

let dir: string;

function policy(over: Partial<ReadCachePolicy> = {}): ReadCachePolicy {
  return { tool: "lore_search_memory", args: { query: "auth" }, repo: "re-cinq/lore", ttlSeconds: 60, ...over };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-cache-"));
  process.env.LORE_CACHE_DIR = dir;
  delete process.env.LORE_CACHE_ENABLED;
});

afterEach(() => {
  delete process.env.LORE_CACHE_DIR;
  delete process.env.LORE_CACHE_ENABLED;
  rmSync(dir, { recursive: true, force: true });
});

describe("buildKey", () => {
  it("is stable across argument ordering", () => {
    expect(buildKey("t", { a: 1, b: 2 })).toBe(buildKey("t", { b: 2, a: 1 }));
  });

  it("differs by repo", () => {
    expect(buildKey("t", { a: 1 }, "owner/a")).not.toBe(buildKey("t", { a: 1 }, "owner/b"));
  });
});

describe("read-through cache", () => {
  it("returns a fresh hit within ttl", () => {
    store(policy(), "results");
    expect(readFresh(policy())).toEqual({ body: "results", ageSeconds: expect.any(Number) });
  });

  it("returns null on a miss", () => {
    expect(readFresh(policy({ args: { query: "never-stored" } }))).toBeNull();
  });

  it("does not return an expired entry as fresh but readAny still serves it", () => {
    store(policy({ ttlSeconds: 0 }), "stale-body");
    expect(readFresh(policy({ ttlSeconds: 0 }))).toBeNull();
    expect(readAny(policy({ ttlSeconds: 0 }))?.body).toBe("stale-body");
  });

  it("isolates entries by repo", () => {
    store(policy({ repo: "owner/a" }), "a-body");
    expect(readFresh(policy({ repo: "owner/b" }))).toBeNull();
  });
});

describe("invalidate", () => {
  it("removes entries for the named tool only", () => {
    store(policy({ tool: "lore_search_memory" }), "s");
    store(policy({ tool: "lore_query_graph" }), "g");
    invalidate(["lore_search_memory"]);
    expect(readAny(policy({ tool: "lore_search_memory" }))).toBeNull();
    expect(readAny(policy({ tool: "lore_query_graph" }))?.body).toBe("g");
  });

  it("scopes removal to a repo when given", () => {
    store(policy({ repo: "owner/a" }), "a");
    store(policy({ repo: "owner/b" }), "b");
    invalidate(["lore_search_memory"], "owner/a");
    expect(readAny(policy({ repo: "owner/a" }))).toBeNull();
    expect(readAny(policy({ repo: "owner/b" }))?.body).toBe("b");
  });
});

describe("eviction", () => {
  it("evicts the oldest entries past max_entries", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ max_entries: 2 }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T00:00:00Z"));
    store(policy({ args: { query: "one" } }), "1");
    vi.setSystemTime(new Date("2026-06-17T00:01:00Z"));
    store(policy({ args: { query: "two" } }), "2");
    vi.setSystemTime(new Date("2026-06-17T00:02:00Z"));
    store(policy({ args: { query: "three" } }), "3");
    vi.useRealTimers();
    expect(readdirSync(join(dir, "entries")).filter(f => f.endsWith(".json"))).toHaveLength(2);
    expect(readAny(policy({ args: { query: "one" } }))).toBeNull();
    expect(readAny(policy({ args: { query: "three" } }))?.body).toBe("3");
  });
});

describe("disabled mode", () => {
  it("is a no-op when LORE_CACHE_ENABLED=false", () => {
    process.env.LORE_CACHE_ENABLED = "false";
    expect(isCacheEnabled()).toBe(false);
    store(policy(), "x");
    expect(existsSync(join(dir, "entries"))).toBe(false);
    expect(readFresh(policy())).toBeNull();
  });
});

describe("staleness markers", () => {
  it("labels fresh and stale bodies distinctly", () => {
    expect(markFresh("body", 42)).toContain("lore-cache: HIT");
    expect(markStale("body", 120)).toContain("lore-cache: STALE");
    expect(markStale("body", 120)).toContain("body");
  });
});
