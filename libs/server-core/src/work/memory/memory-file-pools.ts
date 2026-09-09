// Shared-pool operations for the file-backed memory store (T025): cross-agent key/value pools under ~/.lore/memory/shared/<pool>/memories.json.

import { join } from "node:path";
import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  nextVersionFor,
  BASE_DIR,
  type MemoryRecord,
  type MemoryEntry,
  activeMemoryEntry,
  readJson,
  writeJson,
  appendAudit,
} from "./memory-file-core.js";

function sharedPoolDir(pool: string): string {
  return join(BASE_DIR, "shared", pool);
}

function sharedMemoriesPath(pool: string): string {
  return join(sharedPoolDir(pool), "memories.json");
}

export interface SharedWriteResult {
  pool: string;
  key: string;
  version: number;
  agent_id: string;
  created_at: string;
}

// A pool entry never expires and is never soft-deleted: a shared pool is what several agents agreed on, so retiring an entry is a decision for whoever wrote it, not a TTL.
function sharedRecord(
  value: string,
  version: number,
  now: string,
): MemoryRecord {
  return {
    value,
    version,
    created_at: now,
    ttl_seconds: null,
    is_deleted: false,
    expires_at: null,
  };
}

// The audit entry for a pool write, naming the POOL as well as the agent — a shared entry is attributable to both, and the pool is what another agent would search by.
function sharedWriteAudit(
  id: string,
  pool: string,
  key: string,
  version: number,
) {
  return {
    agent_id: id,
    operation: "shared_write" as const,
    memory_key: key,
    pool_name: pool,
    metadata: { version },
  };
}

export function sharedWriteFile(
  pool: string,
  key: string,
  value: string,
  agentId?: string,
): SharedWriteResult {
  const now = new Date().toISOString();
  const filePath = sharedMemoriesPath(pool);

  const memories = readJson<Record<string, MemoryRecord>>(filePath, {});

  const nextVersion = nextVersionFor(memories[key]);

  memories[key] = sharedRecord(value, nextVersion, now);
  writeJson(filePath, memories);

  const id = resolveAgentId(agentId);

  appendAudit(sharedWriteAudit(id, pool, key, nextVersion));

  return { pool, key, version: nextVersion, agent_id: id, created_at: now };
}

export function sharedReadFile(
  pool: string,
  key?: string,
): MemoryEntry | MemoryEntry[] | null {
  const filePath = sharedMemoriesPath(pool);
  const memories = readJson<Record<string, MemoryRecord>>(filePath, {});

  // Return a specific key
  if (key !== undefined) {
    return activeMemoryEntry(key, memories[key]);
  }

  // Return all active entries in the pool
  const entries = Object.entries(memories)
    .map(([poolKey, record]) => activeMemoryEntry(poolKey, record))
    .filter((entry): entry is MemoryEntry => entry !== null);

  return entries.length > 0 ? entries : null;
}
