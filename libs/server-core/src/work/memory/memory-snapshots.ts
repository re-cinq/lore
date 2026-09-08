import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { resolveAgentId } from "@re-cinq/lore-shared";
import { getMemoryPool, auditLog } from "./memory-core.js";

// Snapshots (PostgreSQL-backed): point-in-time capture and restore of an agent's memories.

// The memories this snapshot pins, as (id, version) refs. Expired and deleted rows are excluded: a snapshot restores what the agent HAD, and reviving something that had already lapsed would be a change rather than a restore.
async function liveMemoryRefs(
  pool: NonNullable<ReturnType<typeof getMemoryPool>>,
  agent: string,
): Promise<Array<{ memory_id: string; version: number }>> {
  const { rows } = await pool.query(
    `SELECT id, version FROM memory.memories WHERE agent_id = $1 AND is_deleted = FALSE AND (expires_at IS NULL OR expires_at > now())`,
    [agent],
  );

  return rows.map((m) => ({
    memory_id: m.id as string,
    version: m.version as number,
  }));
}

export async function createSnapshot(agentId?: string) {
  const agent = resolveAgentId(agentId);
  const pool = getMemoryPool()!;
  const memoryRefs = await liveMemoryRefs(pool, agent);
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

/** Puts each memory back to the version the snapshot names, embedding included — a value restored without its embedding stays invisible to search, which is worse than not restoring it. A ref whose version row is gone is left alone rather than blanked. */
async function revertToVersions(
  pool: NonNullable<ReturnType<typeof getMemoryPool>>,
  refs: Array<{ memory_id: string; version: number }>,
): Promise<void> {
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
}

// The snapshot row, or a refusal. A missing snapshot is an error rather than a no-op: the caller asked to restore a specific point in time, and silently restoring nothing would look like it worked.
async function loadSnapshot(
  pool: NonNullable<ReturnType<typeof getMemoryPool>>,
  snapshotId: string,
) {
  const { rows: snaps } = await pool.query(
    `SELECT agent_id, memory_refs, created_at FROM memory.snapshots WHERE id = $1`,
    [snapshotId],
  );

  enforceTrue(snaps.length !== 0, Error, "Snapshot not found");

  return snaps[0];
}

// Soft-deletes memories written after the snapshot that it does not name. Bounded by `created_at`, so a memory that predates the snapshot but was left out of it — one that had expired, say — is not swept along with the new ones.
async function pruneCreatedAfter(
  pool: NonNullable<ReturnType<typeof getMemoryPool>>,
  snap: Record<string, unknown>,
  refs: Array<{ memory_id: string; version: number }>,
): Promise<void> {
  await pool.query(
    `UPDATE memory.memories SET is_deleted = TRUE WHERE agent_id = $1 AND id != ALL($2::uuid[]) AND created_at > $3`,
    [snap.agent_id, refs.map((r) => r.memory_id), snap.created_at],
  );
}

export async function restoreSnapshot(snapshotId: string) {
  const pool = getMemoryPool()!;
  const snap = await loadSnapshot(pool, snapshotId);
  const refs = snap.memory_refs as Array<{
    memory_id: string;
    version: number;
  }>;

  await revertToVersions(pool, refs);
  await pruneCreatedAfter(pool, snap, refs);
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
