// File-backed fallback for memory operations (T007): same signatures as memory.ts but JSON files under ~/.lore/memory/ (<agent-id>/{memories,versions}.json, shared/<pool>/memories.json, audit.jsonl append-only).

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveAgentId } from "@re-cinq/lore-shared";

// ── Paths ────────────────────────────────────────────────────────────

export const BASE_DIR = join(process.env.HOME || "/tmp", ".lore", "memory");
const AUDIT_FILE = join(BASE_DIR, "audit.jsonl");

export function agentDir(agentId: string): string {
  return join(BASE_DIR, agentId);
}

export function memoriesPath(agentId: string): string {
  return join(agentDir(agentId), "memories.json");
}

function versionsPath(agentId: string): string {
  return join(agentDir(agentId), "versions.json");
}

// ── Types ────────────────────────────────────────────────────────────

// The on-disk memories.json record; snake_case mirrors memory.ts's raw pg-row output, this backend's parity contract.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface MemoryRecord {
  value: string;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  is_deleted: boolean;
  expires_at: string | null;
}

export interface VersionRecord {
  version: number;
  value: string;
  created_at: string;
}

export interface WriteResult {
  key: string;
  version: number;
  agent_id: string;
  created_at: string;
}

// The read/search wire response; snake_case matches memory.ts's raw pg-row output, this backend's parity contract.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface MemoryEntry {
  key: string;
  value: string;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  is_deleted: boolean;
  expires_at: string | null;
}

// What a LISTING answers — the pool path's projection, field for field: no `value` (a page of full values is a page of whole documents), `repo`/`has_facts` stated as the null/false this store can honestly answer.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface MemoryListEntry {
  key: string;
  agent_id: string;
  repo: string | null;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  has_facts: boolean;
}

export interface SearchResult {
  key: string;
  value: string;
  version: number;
  score: number;
  agent_id: string;
  created_at: string;
  // Always "memory": this store holds nothing else, but the endpoint declares one shape for both backends (the pool path also answers facts/episodes/graph hits).
  source: "memory";
}

// ── Safe JSON read / write ───────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) {
      return fallback;
    }
    const raw = readFileSync(filePath, "utf-8");

    return JSON.parse(raw) as T;
  } catch {
    // Corrupted JSON — reset to fallback
    return fallback;
  }
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

// ── Audit log ────────────────────────────────────────────────────────

// The audit.jsonl entry shape; snake_case mirrors memory.audit_log's raw pg-row output (models/memory-audit-entry.ts).
// eslint-disable-next-line lore/no-row-types-outside-models
interface AuditEntry {
  id: string;
  agent_id: string;
  operation: string;
  memory_key: string | null;
  pool_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function appendAudit(
  entry: Omit<AuditEntry, "id" | "created_at">,
): void {
  ensureDir(BASE_DIR);
  const full: AuditEntry = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    ...entry,
  };

  try {
    appendFileSync(AUDIT_FILE, JSON.stringify(full) + "\n", "utf-8");
  } catch {
    // Best-effort — don't fail the operation if audit write fails
  }
}

// ── Expiration helper ────────────────────────────────────────────────

export function isExpired(record: MemoryRecord): boolean {
  if (!record.expires_at) {
    return false;
  }

  return new Date(record.expires_at) <= new Date();
}

// ── Write ────────────────────────────────────────────────────────────

function resolveExpiresAt(ttlSeconds?: number): string | null {
  if (!ttlSeconds) {
    return null;
  }

  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function nextVersionFor(existing: MemoryRecord | undefined): number {
  if (existing && !existing.is_deleted) {
    return existing.version + 1;
  }

  return 1;
}

export function writeMemoryFile(
  key: string,
  value: string,
  agentId?: string,
  ttlSeconds?: number,
): WriteResult {
  const id = resolveAgentId(agentId);
  const now = new Date().toISOString();
  const expiresAt = resolveExpiresAt(ttlSeconds);
  const ttl = ttlSeconds ?? null;

  // Read current state
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});
  const versions = readJson<Record<string, VersionRecord[]>>(
    versionsPath(id),
    {},
  );

  const nextVersion = nextVersionFor(memories[key]);

  // Update memory record (last-write-wins)
  memories[key] = {
    value,
    version: nextVersion,
    created_at: now,
    ttl_seconds: ttl,
    is_deleted: false,
    expires_at: expiresAt,
  };

  // Append version history
  if (!versions[key]) {
    versions[key] = [];
  }
  versions[key].push({
    version: nextVersion,
    value,
    created_at: now,
  });

  // Persist
  writeJson(memoriesPath(id), memories);
  writeJson(versionsPath(id), versions);

  // Audit
  appendAudit({
    agent_id: id,
    operation: "write",
    memory_key: key,
    pool_name: null,
    metadata: { version: nextVersion, ttl_seconds: ttl },
  });

  return { key, version: nextVersion, agent_id: id, created_at: now };
}

// ── Read ─────────────────────────────────────────────────────────────

/** The record as a MemoryEntry, or null when it is absent, deleted, or expired. */
export function activeMemoryEntry(
  key: string,
  record: MemoryRecord | undefined,
): MemoryEntry | null {
  if (!record || record.is_deleted || isExpired(record)) {
    return null;
  }

  return {
    key,
    value: record.value,
    version: record.version,
    created_at: record.created_at,
    ttl_seconds: record.ttl_seconds,
    is_deleted: record.is_deleted,
    expires_at: record.expires_at,
  };
}

/** Full version history sorted by version descending (newest first). */
function versionHistoryDescending(
  agentId: string,
  key: string,
): VersionRecord[] | null {
  const versions = readJson<Record<string, VersionRecord[]>>(
    versionsPath(agentId),
    {},
  );
  const history = versions[key];

  if (!history || history.length === 0) {
    return null;
  }

  return [...history].sort((a, b) => b.version - a.version);
}

export function readMemoryFile(
  key: string,
  agentId?: string,
  version?: number | "all",
): MemoryEntry | VersionRecord[] | null {
  const id = resolveAgentId(agentId);

  // Audit
  appendAudit({
    agent_id: id,
    operation: "read",
    memory_key: key,
    pool_name: null,
    metadata: { version: version ?? "latest" },
  });

  if (version === "all") {
    return versionHistoryDescending(id, key);
  }

  // Return latest version
  if (typeof version !== "number") {
    const memories = readJson<Record<string, MemoryRecord>>(
      memoriesPath(id),
      {},
    );

    return activeMemoryEntry(key, memories[key]);
  }

  // Return a specific version
  const versions = readJson<Record<string, VersionRecord[]>>(
    versionsPath(id),
    {},
  );
  const history = versions[key];

  if (!history) {
    return null;
  }
  const match = history.find((v) => v.version === version);

  if (!match) {
    return null;
  }

  return {
    key,
    value: match.value,
    version: match.version,
    created_at: match.created_at,
    ttl_seconds: null,
    is_deleted: false,
    expires_at: null,
  };
}

// ── Delete (soft-delete) ─────────────────────────────────────────────

export function deleteMemoryFile(
  key: string,
  agentId?: string,
): { key: string; deleted: boolean } {
  const id = resolveAgentId(agentId);
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});

  const record = memories[key];

  if (!record || record.is_deleted) {
    return { key, deleted: false };
  }

  record.is_deleted = true;
  writeJson(memoriesPath(id), memories);

  appendAudit({
    agent_id: id,
    operation: "delete",
    memory_key: key,
    pool_name: null,
    metadata: null,
  });

  return { key, deleted: true };
}

// Pools/snapshots/list/search live in sibling files, re-exported for import-path back-compat.
export {
  sharedWriteFile,
  sharedReadFile,
  type SharedWriteResult,
} from "./memory-file-pools.js";
export {
  createSnapshotFile,
  restoreSnapshotFile,
  type SnapshotRecord,
} from "./memory-file-snapshots.js";
export { listMemoriesFile, searchMemoryFile } from "./memory-file-query.js";
