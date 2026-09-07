// Snapshot backup/restore for the file-backed memory store (T028): full point-in-time copies under ~/.lore/memory/<agent-id>/snapshots/.

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  agentDir,
  memoriesPath,
  isExpired,
  type MemoryRecord,
  readJson,
  writeJson,
  appendAudit,
} from "./memory-file-core.js";

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

type MemoryRefs = Record<string, { value: string; version: number }>;

/** What a snapshot captures: value and version of everything alive at that moment. Deleted and expired records are skipped, so restoring never resurrects them. */
function liveRefs(memories: Record<string, MemoryRecord>): MemoryRefs {
  const refs: MemoryRefs = {};

  for (const [key, record] of Object.entries(memories)) {
    if (record.is_deleted || isExpired(record)) {
      continue;
    }
    refs[key] = { value: record.value, version: record.version };
  }

  return refs;
}

/** Rebuilds records from a snapshot's refs. `created_at` is the RESTORE time, not the original — a snapshot carries no TTL, so a restored memory starts a fresh life rather than inheriting an expiry that has already passed. */
function recordsFrom(
  refs: MemoryRefs,
  now: string,
): Record<string, MemoryRecord> {
  return Object.fromEntries(
    Object.entries(refs).map(([key, ref]) => [
      key,
      {
        value: ref.value,
        version: ref.version,
        created_at: now,
        ttl_seconds: null,
        is_deleted: false,
        expires_at: null,
      },
    ]),
  );
}

/** Both halves of a snapshot record the same two facts, and the pair is what makes an audit line answerable: which file, and how much of the store it holds. */
function auditSnapshot(
  operation: string,
  agentId: string,
  snapshotPath: string,
  memoryCount: number,
): void {
  appendAudit({
    agent_id: agentId,
    operation,
    memory_key: null,
    pool_name: null,
    metadata: { snapshot_path: snapshotPath, memory_count: memoryCount },
  });
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

  const memoryRefs = liveRefs(memories);

  const snapshot: SnapshotRecord = {
    snapshot_id: randomUUID(),
    agent_id: id,
    created_at: now,
    memory_refs: memoryRefs,
  };

  writeJson(snapshotPath, snapshot);

  auditSnapshot(
    "create_snapshot",
    id,
    snapshotPath,
    Object.keys(memoryRefs).length,
  );

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

  const restoredMemories = recordsFrom(snapshot.memory_refs, now);

  writeJson(memoriesPath(id), restoredMemories);

  auditSnapshot(
    "restore_snapshot",
    id,
    snapshotPath,
    Object.keys(restoredMemories).length,
  );

  return { restored: true, memory_count: Object.keys(restoredMemories).length };
}
