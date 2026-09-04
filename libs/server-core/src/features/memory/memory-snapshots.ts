import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { resolveAgentId } from "../../platform/agent-id.js";
import { getMemoryPool, auditLog } from "./memory.js";

// Snapshots (PostgreSQL-backed): point-in-time capture and restore of an agent's memories.

export async function createSnapshot(agentId?: string) {
  const agent = resolveAgentId(agentId);
  const pool = getMemoryPool()!;
  const { rows: memories } = await pool.query(
    `SELECT id, version FROM memory.memories WHERE agent_id = $1 AND is_deleted = FALSE AND (expires_at IS NULL OR expires_at > now())`,
    [agent],
  );
  const memoryRefs = memories.map((m) => ({
    memory_id: m.id,
    version: m.version,
  }));
  const { rows } = await pool.query(
    `INSERT INTO memory.snapshots (agent_id, memory_refs, trigger) VALUES ($1, $2, 'manual') RETURNING id, created_at`,
    [agent, JSON.stringify(memoryRefs)],
  );

  await auditLog(agent, "snapshot", null, {
    snapshot_id: rows[0].id,
    memory_count: memoryRefs.length,
  });

  return {
    snapshot_id: rows[0].id,
    agent_id: agent,
    memory_count: memoryRefs.length,
    created_at: rows[0].created_at,
  };
}

export async function restoreSnapshot(snapshotId: string) {
  const pool = getMemoryPool()!;
  const { rows: snaps } = await pool.query(
    `SELECT agent_id, memory_refs, created_at FROM memory.snapshots WHERE id = $1`,
    [snapshotId],
  );

  enforceTrue(snaps.length !== 0, Error, "Snapshot not found");
  const snap = snaps[0];
  const refs = snap.memory_refs as Array<{
    memory_id: string;
    version: number;
  }>;
  const refIds = refs.map((r) => r.memory_id);

  // Revert each memory to snapshotted version
  for (const ref of refs) {
    const { rows: ver } = await pool.query(
      `SELECT value, embedding FROM memory.memory_versions WHERE memory_id = $1 AND version = $2`,
      [ref.memory_id, ref.version],
    );

    if (ver.length > 0) {
      await pool.query(
        `UPDATE memory.memories SET value = $1, version = $2, embedding = $3, is_deleted = FALSE WHERE id = $4`,
        [ver[0].value, ref.version, ver[0].embedding, ref.memory_id],
      );
    }
  }
  // Soft-delete memories created after snapshot that aren't in refs
  await pool.query(
    `UPDATE memory.memories SET is_deleted = TRUE WHERE agent_id = $1 AND id != ALL($2::uuid[]) AND created_at > $3`,
    [snap.agent_id, refIds, snap.created_at],
  );
  await auditLog(snap.agent_id as string, "restore", null, {
    snapshot_id: snapshotId,
    restored_count: refs.length,
  });

  return {
    snapshot_id: snapshotId,
    memories_restored: refs.length,
    snapshot_created_at: snap.created_at,
  };
}
