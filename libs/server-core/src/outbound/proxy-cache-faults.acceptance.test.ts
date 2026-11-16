import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withReadCache } from "./proxy.js";
import { buildKey, readFresh, store, isCacheEnabled, type ReadCachePolicy } from "./proxy-cache.js";

let dir: string;

function policy(over: Partial<ReadCachePolicy> = {}): ReadCachePolicy {
  return {
    tool: "lore_search_memory",
    args: { query: "auth" },
    repo: "re-cinq/lore",
    ttlSeconds: 60,
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-cache-"));
  process.env.LORE_CACHE_DIR = dir;
  delete process.env.LORE_CACHE_ENABLED;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Cache I/O Fault Tolerance", () => {
  it("A read whose cache write fails still returns the proxied answer", async () => {
    const entriesDir = join(dir, "entries");

    mkdirSync(entriesDir, { recursive: true });
    chmodSync(entriesDir, 0o555);

    const doProxy = async () => ({ ok: true as const, body: "proxied-data" });
    const p = policy();

    const result = await withReadCache(p, doProxy);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.body).toBe("proxied-data");
    }
  });

  it("A malformed or truncated cache entry is a miss and is replaced on the next read", () => {
    const p = policy();
    const key = buildKey(p.tool, p.args, p.repo);
    const entriesDir = join(dir, "entries");

    mkdirSync(entriesDir, { recursive: true });
    const entryPath = join(entriesDir, `lore_search_memory.${key}.json`);

    writeFileSync(entryPath, '{"some": "other-shape"}');

    expect(readFresh(p)).toBeNull();

    store(p, "new-body");
    const fresh = readFresh(p);

    expect(fresh?.body).toBe("new-body");
  });

  it("A cache path that is a symlink is not written through", () => {
    const p = policy();
    const key = buildKey(p.tool, p.args, p.repo);
    const entriesDir = join(dir, "entries");

    mkdirSync(entriesDir, { recursive: true });
    const entryPath = join(entriesDir, `lore_search_memory.${key}.json`);

    const targetPath = join(dir, "target.json");

    writeFileSync(targetPath, '{"original":true}');
    symlinkSync(targetPath, entryPath);

    store(p, "new-body");

    const targetContent = readFileSync(targetPath, "utf-8");

    expect(targetContent).toBe('{"original":true}');
  });

  it("A malformed config.json falls back to the defaults", () => {
    writeFileSync(join(dir, "config.json"), '{"enabled": "not_a_boolean"}');

    expect(isCacheEnabled()).toBe(true);
  });
});
