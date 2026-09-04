/** Local read-through cache for stdio proxy (derived data, never authority; see local-read-cache spec). */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

export interface ReadCachePolicy {
  tool: string;
  args: Record<string, unknown>;
  repo?: string;
  ttlSeconds: number;
}

interface CacheConfig {
  enabled: boolean;
  max_entries: number;
  ttl_overrides: Record<string, number>;
}

interface CacheEntry {
  tool: string;
  repo: string;
  body: string;
  storedAt: string;
  ttlSeconds: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  enabled: true,
  max_entries: 2000,
  ttl_overrides: {},
};

function baseDir(): string {
  return (
    process.env.LORE_CACHE_DIR ||
    join(process.env.HOME || "/tmp", ".lore", "cache")
  );
}

function entriesDir(): string {
  return join(baseDir(), "entries");
}

// Tool prefixes filename (sanitized) so invalidate can filter by name without opening entries.
function fileToolPrefix(tool: string): string {
  return tool.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function entryPath(tool: string, key: string): string {
  return join(entriesDir(), `${fileToolPrefix(tool)}.${key}.json`);
}

// Owner-only (0700) so cached org reads are not world-readable on a shared box.
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) {
      return fallback;
    }

    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

// 0600: cached read bodies can contain org memory/context; keep them owner-only.
function writeJson(filePath: string, value: unknown): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function safeUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // best-effort
  }
}

function loadConfig(): CacheConfig {
  return {
    ...DEFAULT_CONFIG,
    ...readJson<Partial<CacheConfig>>(join(baseDir(), "config.json"), {}),
  };
}

export function isCacheEnabled(): boolean {
  if (process.env.LORE_CACHE_ENABLED === "false") {
    return false;
  }

  if (process.env.LORE_CACHE_ENABLED === "true") {
    return true;
  }

  return loadConfig().enabled;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();

  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
}

export function buildKey(
  tool: string,
  args: Record<string, unknown>,
  repo?: string,
): string {
  // NUL (\x00) separator prevents collisions; written as escape to keep file text.
  return createHash("sha256")
    .update(`${tool}\x00${canonical(args)}\x00${repo || ""}`)
    .digest("hex");
}

function ageSeconds(entry: CacheEntry): number {
  return Math.max(
    0,
    Math.floor((Date.now() - Date.parse(entry.storedAt)) / 1000),
  );
}

function effectiveTtl(policy: ReadCachePolicy): number {
  const override = loadConfig().ttl_overrides[policy.tool];

  return typeof override === "number" ? override : policy.ttlSeconds;
}

function readEntry(policy: ReadCachePolicy): CacheEntry | null {
  return readJson<CacheEntry | null>(
    entryPath(policy.tool, buildKey(policy.tool, policy.args, policy.repo)),
    null,
  );
}

export function readFresh(
  policy: ReadCachePolicy,
): { body: string; ageSeconds: number } | null {
  if (!isCacheEnabled()) {
    return null;
  }
  const entry = readEntry(policy);

  if (!entry) {
    return null;
  }
  const age = ageSeconds(entry);

  if (age >= entry.ttlSeconds) {
    return null;
  }

  return { body: entry.body, ageSeconds: age };
}

export function readAny(
  policy: ReadCachePolicy,
): { body: string; ageSeconds: number } | null {
  if (!isCacheEnabled()) {
    return null;
  }
  const entry = readEntry(policy);

  if (!entry) {
    return null;
  }

  return { body: entry.body, ageSeconds: ageSeconds(entry) };
}

export function store(policy: ReadCachePolicy, body: string): void {
  if (!isCacheEnabled()) {
    return;
  }
  const entry: CacheEntry = {
    tool: policy.tool,
    repo: policy.repo || "",
    body,
    storedAt: new Date().toISOString(),
    ttlSeconds: effectiveTtl(policy),
  };

  writeJson(
    entryPath(policy.tool, buildKey(policy.tool, policy.args, policy.repo)),
    entry,
  );
  evictIfNeeded();
}

function matchesTool(file: string, prefixes: Set<string>): boolean {
  return (
    file.endsWith(".json") && prefixes.has(file.slice(0, file.indexOf(".") + 1))
  );
}

// Scoped entries need a read to confirm repo match; unscoped entries unlink straight off filename.
function matchesRepoScope(path: string, repo: string | undefined): boolean {
  if (repo === undefined) {
    return true;
  }

  return readJson<CacheEntry | null>(path, null)?.repo === repo;
}

export function invalidate(tools: string[], repo?: string): void {
  if (!existsSync(entriesDir())) {
    return;
  }
  const prefixes = new Set(tools.map((t) => `${fileToolPrefix(t)}.`));
  const matches = readdirSync(entriesDir()).filter((file) =>
    matchesTool(file, prefixes),
  );

  for (const file of matches) {
    const path = join(entriesDir(), file);

    if (matchesRepoScope(path, repo)) {
      safeUnlink(path);
    }
  }
}

function evictIfNeeded(): void {
  const { max_entries } = loadConfig();

  if (!existsSync(entriesDir())) {
    return;
  }
  const files = readdirSync(entriesDir()).filter((f) => f.endsWith(".json"));

  if (files.length <= max_entries) {
    return;
  }
  const sorted = files
    .map((f) => {
      const path = join(entriesDir(), f);
      const entry = readJson<CacheEntry | null>(path, null);

      return { path, storedAt: entry ? Date.parse(entry.storedAt) : 0 };
    })
    .sort((a, b) => a.storedAt - b.storedAt);

  for (const { path } of sorted.slice(0, files.length - max_entries)) {
    safeUnlink(path);
  }
}

function formatAge(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }

  return `${Math.floor(seconds / 3600)}h`;
}

export function markFresh(body: string, age: number): string {
  return `<!-- lore-cache: HIT, age ${formatAge(age)} -->\n${body}`;
}

export function markStale(body: string, age: number): string {
  return (
    `<!-- lore-cache: STALE — cached ${formatAge(age)} ago, backend unreachable, ` +
    `serving cached copy. Reconnect to refresh. -->\n${body}`
  );
}
