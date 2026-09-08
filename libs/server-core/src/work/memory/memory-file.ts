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

/** Writes the record and its version entry. Both files are rewritten, current first — a crash between them leaves the memory readable with one version entry missing, which the reverse order would invert into a version history for a memory that is not there. */
function persistWrite(write: {
  id: string;
  key: string;
  record: MemoryRecord;
}): number {
  const { id, key, record } = write;
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});
  const versions = readJson<Record<string, VersionRecord[]>>(
    versionsPath(id),
    {},
  );
  const version = nextVersionFor(memories[key]);

  memories[key] = { ...record, version };
  appendVersion(versions, key, {
    version,
    value: record.value,
    created_at: record.created_at,
  });

  writeJson(memoriesPath(id), memories);
  writeJson(versionsPath(id), versions);

  return version;
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
  // `version: 0` is a placeholder — persistWrite reads the current record to decide the real one, which it returns.
  const nextVersion = persistWrite({
    id,
    key,
    record: {
      value,
      version: 0,
      created_at: now,
      ttl_seconds: ttl,
      is_deleted: false,
      expires_at: resolveExpiresAt(ttlSeconds),
    },
  });

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

  return versionAt(id, key, version);
}

// ── Delete (soft-delete) ─────────────────────────────────────────────

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
