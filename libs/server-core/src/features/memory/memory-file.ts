// File-backed fallback for memory operations (T007): same signatures as memory.ts but JSON files under ~/.lore/memory/ (<agent-id>/{memories,versions}.json, shared/<pool>/memories.json, audit.jsonl append-only).

import { join } from "node:path";
import { resolveAgentId } from "@re-cinq/lore-shared";
import {
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
