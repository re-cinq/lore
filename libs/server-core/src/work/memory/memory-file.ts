// File-backed fallback for memory operations (T007): same signatures as memory.ts but JSON files under ~/.lore/memory/ (<agent-id>/{memories,versions}.json, shared/<pool>/memories.json, audit.jsonl append-only).

import { join } from "node:path";
import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  nextVersionFor,
  agentDir,
  memoriesPath,
  type MemoryRecord,
  type WriteResult,
  type MemoryEntry,
  readJson,
  writeJson,
  appendAudit,
  activeMemoryEntry,
} from "./memory-file-core.js";

// Paths, JSON I/O, audit, and wire types live in memory-file-core.ts, re-exported for import-path back-compat.
export {
  BASE_DIR,
  agentDir,
  memoriesPath,
  type MemoryRecord,
  type WriteResult,
  type MemoryEntry,
  type MemoryListEntry,
  type SearchResult,
  readJson,
  writeJson,
  appendAudit,
  isExpired,
  activeMemoryEntry,
} from "./memory-file-core.js";

function versionsPath(agentId: string): string {
  return join(agentDir(agentId), "versions.json");
}

export interface VersionRecord {
  version: number;
  value: string;
  created_at: string;
}

// ── Write ────────────────────────────────────────────────────────────

function resolveExpiresAt(ttlSeconds?: number): string | null {
  if (!ttlSeconds) {
    return null;
  }

  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

/** History is append-only: the record above is last-write-wins, so the only way to see what a memory used to say is this list. */
function appendVersion(
  versions: Record<string, VersionRecord[]>,
  key: string,
  entry: VersionRecord,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- read from disk JSON; this key may genuinely be absent
  if (!versions[key]) {
    versions[key] = [];
  }
  versions[key].push(entry);
}

// Both files as they currently stand. Read together because a write touches both, and reading them at different moments would let a concurrent writer land between.
function readBoth(id: string) {
  return {
    memories: readJson<Record<string, MemoryRecord>>(memoriesPath(id), {}),
    versions: readJson<Record<string, VersionRecord[]>>(versionsPath(id), {}),
  };
}

// Current first, then history. A crash between them leaves the memory readable with one version entry missing; the reverse order would invert that into a version history for a memory that is not there.
function flushBoth(
  id: string,
  memories: Record<string, MemoryRecord>,
  versions: Record<string, VersionRecord[]>,
): void {
  writeJson(memoriesPath(id), memories);
  writeJson(versionsPath(id), versions);
}

/** Writes the record and its version entry. Both files are rewritten, current first — a crash between them leaves the memory readable with one version entry missing, which the reverse order would invert into a version history for a memory that is not there. */
function persistWrite(write: {
  id: string;
  key: string;
  record: MemoryRecord;
}): number {
  const { id, key, record } = write;
  const { memories, versions } = readBoth(id);
  const version = nextVersionFor(memories[key]);

  memories[key] = { ...record, version };
  appendVersion(versions, key, {
    version,
    value: record.value,
    created_at: record.created_at,
  });
  flushBoth(id, memories, versions);

  return version;
}

// The audit entry for one write. `pool_name` is null because this is an agent's own memory — a pool write records the pool it landed in instead.
function writeAudit(
  id: string,
  key: string,
  version: number,
  ttl: number | null,
) {
  return {
    agent_id: id,
    operation: "write" as const,
    memory_key: key,
    pool_name: null,
    metadata: { version, ttl_seconds: ttl },
  };
}

// The record as written. `version: 0` is a placeholder — persistWrite reads the current record to decide the real version, and returns it.
function newRecord(
  value: string,
  now: string,
  ttlSeconds?: number,
): MemoryRecord {
  return {
    value,
    version: 0,
    created_at: now,
    ttl_seconds: ttlSeconds ?? null,
    is_deleted: false,
    expires_at: resolveExpiresAt(ttlSeconds),
  };
}

export function writeMemoryFile(
  key: string,
  value: string,
  agentId?: string,
  ttlSeconds?: number,
): WriteResult {
  const id = resolveAgentId(agentId);
  const now = new Date().toISOString();
  const ttl = ttlSeconds ?? null;
  const nextVersion = persistWrite({
    id,
    key,
    record: newRecord(value, now, ttlSeconds),
  });

  appendAudit(writeAudit(id, key, nextVersion, ttl));

  return { key, version: nextVersion, agent_id: id, created_at: now };
}

// ── Read ─────────────────────────────────────────────────────────────

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

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- versions is Record<string, VersionRecord[]> read from disk JSON; this key may genuinely be absent
  if (!history || history.length === 0) {
    return null;
  }

  return [...history].sort((a, b) => b.version - a.version);
}

// A past value as a memory entry. TTL and deletion are deliberately blank: they describe the key's CURRENT state, and reporting a live expiry against an old version would say the past expires.
function historicalEntry(key: string, match: VersionRecord): MemoryEntry {
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

/** One numbered version, as a memory entry. TTL and deletion are deliberately blank: they describe the key's CURRENT state, and this is a historical value — reporting a live expiry against an old version would say the past expires. */
function versionAt(
  agentId: string,
  key: string,
  version: number,
): MemoryEntry | null {
  const versions = readJson<Record<string, VersionRecord[]>>(
    versionsPath(agentId),
    {},
  );
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- versions is Record<string, VersionRecord[]> read from disk JSON; this key may genuinely be absent
  const match = versions[key]?.find((v) => v.version === version);

  return match ? historicalEntry(key, match) : null;
}

// The key's current value, if it is still live. Reads the memories file rather than the version history: the latest version and the current record can differ when the key has since been deleted.
function latestEntry(id: string, key: string): MemoryEntry | null {
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});

  return activeMemoryEntry(key, memories[key]);
}

export function readMemoryFile(
  key: string,
  agentId?: string,
  version?: number | "all",
): MemoryEntry | VersionRecord[] | null {
  const id = resolveAgentId(agentId);

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

  return typeof version === "number"
    ? versionAt(id, key, version)
    : latestEntry(id, key);
}

// ── Delete (soft-delete) ─────────────────────────────────────────────

// The audit entry for one soft delete. No metadata: the key and the operation are the whole story, and the value is still on disk for anyone who needs it.
function deleteAudit(id: string, key: string) {
  return {
    agent_id: id,
    operation: "delete" as const,
    memory_key: key,
    pool_name: null,
    metadata: null,
  };
}

export function deleteMemoryFile(
  key: string,
  agentId?: string,
): { key: string; deleted: boolean } {
  const id = resolveAgentId(agentId);
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});

  const record = memories[key];

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- memories is Record<string, MemoryRecord> read from disk JSON; this key may genuinely be absent
  if (!record || record.is_deleted) {
    return { key, deleted: false };
  }

  record.is_deleted = true;
  writeJson(memoriesPath(id), memories);
  appendAudit(deleteAudit(id, key));

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
