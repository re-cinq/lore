// Snapshot backup/restore for the file-backed memory store (T028): full point-in-time copies under ~/.lore/memory/<agent-id>/snapshots/.

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveAgentId } from "../../platform/agent-id.js";
import {
  agentDir,
  memoriesPath,
  isExpired,
  type MemoryRecord,
  readJson,
  writeJson,
  appendAudit,
} from "./memory-file.js";

// The on-disk snapshot file shape; snake_case mirrors memory.snapshots' raw pg-row output (models/snapshot.ts).
// eslint-disable-next-line lore/no-row-types-outside-models
export interface SnapshotRecord {
  snapshot_id: string;
  agent_id: string;
  created_at: string;
  memory_refs: Record<string, { value: string; version: number }>;
}

function snapshotsDir(agentId: string): string {
  return join(agentDir(agentId), "snapshots");
}

export function createSnapshotFile(agentId?: string): {
  snapshot_path: string;
  memory_count: number;
  created_at: string;
} {
  const id = resolveAgentId(agentId);
  const now = new Date().toISOString();
  const timestamp = now.replace(/[:.]/g, "-");
  const snapshotPath = join(snapshotsDir(id), `${timestamp}.json`);

  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});

  // Collect all active (non-deleted, non-expired) memories
  const memoryRefs: Record<string, { value: string; version: number }> = {};

  for (const [key, record] of Object.entries(memories)) {
    if (record.is_deleted || isExpired(record)) {
      continue;
    }
    memoryRefs[key] = { value: record.value, version: record.version };
  }

  const snapshot: SnapshotRecord = {
    snapshot_id: randomUUID(),
    agent_id: id,
    created_at: now,
    memory_refs: memoryRefs,
  };

  writeJson(snapshotPath, snapshot);

  appendAudit({
    agent_id: id,
    operation: "create_snapshot",
    memory_key: null,
    pool_name: null,
    metadata: {
      snapshot_path: snapshotPath,
      memory_count: Object.keys(memoryRefs).length,
    },
  });

  return {
    snapshot_path: snapshotPath,
    memory_count: Object.keys(memoryRefs).length,
    created_at: now,
  };
}

export function restoreSnapshotFile(snapshotPath: string): {
  restored: boolean;
  memory_count: number;
} {
  const snapshot = readJson<SnapshotRecord | null>(snapshotPath, null);

  if (!snapshot) {
    return { restored: false, memory_count: 0 };
  }

  const id = snapshot.agent_id;
  const now = new Date().toISOString();

  // Rebuild memories from snapshot refs
  const restoredMemories: Record<string, MemoryRecord> = {};

  for (const [key, ref] of Object.entries(snapshot.memory_refs)) {
    restoredMemories[key] = {
      value: ref.value,
      version: ref.version,
      created_at: now,
      ttl_seconds: null,
      is_deleted: false,
      expires_at: null,
    };
  }

  writeJson(memoriesPath(id), restoredMemories);

  appendAudit({
    agent_id: id,
    operation: "restore_snapshot",
    memory_key: null,
    pool_name: null,
    metadata: {
      snapshot_path: snapshotPath,
      memory_count: Object.keys(restoredMemories).length,
    },
  });

  return { restored: true, memory_count: Object.keys(restoredMemories).length };
}
