// Shared-pool operations for the file-backed memory store (T025): cross-agent key/value pools under ~/.lore/memory/shared/<pool>/memories.json.

import { join } from "node:path";
import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  BASE_DIR,
  type MemoryRecord,
  type MemoryEntry,
  activeMemoryEntry,
  readJson,
  writeJson,
  appendAudit,
} from "./memory-file.js";

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

export function sharedWriteFile(
  pool: string,
  key: string,
  value: string,
  agentId?: string,
): SharedWriteResult {
  const id = resolveAgentId(agentId);
  const now = new Date().toISOString();
  const filePath = sharedMemoriesPath(pool);

  const memories = readJson<Record<string, MemoryRecord>>(filePath, {});

  const existing = memories[key];
  const nextVersion =
    existing && !existing.is_deleted ? existing.version + 1 : 1;

  memories[key] = {
    value,
    version: nextVersion,
    created_at: now,
    ttl_seconds: null,
    is_deleted: false,
    expires_at: null,
  };

  writeJson(filePath, memories);

  appendAudit({
    agent_id: id,
    operation: "shared_write",
    memory_key: key,
    pool_name: pool,
    metadata: { version: nextVersion },
  });

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
