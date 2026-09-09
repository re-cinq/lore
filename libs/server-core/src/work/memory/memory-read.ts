// Reading a memory back: the latest value, one numbered version, or the whole history.

import { getMemoryPool, auditLog } from "./memory-core.js";
import { resolveAgentId } from "@re-cinq/lore-shared";

function isVersionNumberLike(version: string | number | undefined): boolean {
  return (
    typeof version === "number" ||
    (typeof version === "string" && !isNaN(Number(version)))
  );
}

async function readAllVersions(agent: string, key: string) {
  const { rows } = await getMemoryPool()!.query(
    `SELECT mv.version, mv.value, mv.created_at
     FROM memory.memory_versions mv
     JOIN memory.memories m ON m.id = mv.memory_id
     WHERE m.agent_id = $1 AND m.key = $2
     ORDER BY mv.version DESC`,
    [agent, key],
  );

  return rows;
}

// `m.key` is selected so one-version read answers the same shape as a latest read — the endpoint declares one contract for `action: "read"`.
async function readVersionAt(agent: string, key: string, version: number) {
  const { rows } = await getMemoryPool()!.query(
    `SELECT m.key, mv.version, mv.value, mv.created_at
     FROM memory.memory_versions mv
     JOIN memory.memories m ON m.id = mv.memory_id
     WHERE m.agent_id = $1 AND m.key = $2 AND mv.version = $3`,
    [agent, key, version],
  );

  return rows[0] || null;
}

async function readLatestVersion(agent: string, key: string) {
  const { rows } = await getMemoryPool()!.query(
    `SELECT key, value, version, created_at
     FROM memory.memories
     WHERE agent_id = $1 AND key = $2 AND is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY version DESC LIMIT 1`,
    [agent, key],
  );

  return rows[0] || null;
}

export async function readMemory(
  key: string,
  agentId?: string,
  version?: string | number,
) {
  const agent = resolveAgentId(agentId);

  if (version === "all") {
    const rows = await readAllVersions(agent, key);

    await auditLog(agent, "read", key);

    return rows;
  }

  if (isVersionNumberLike(version)) {
    const row = await readVersionAt(agent, key, Number(version));

    await auditLog(agent, "read", key);

    return row;
  }

  const row = await readLatestVersion(agent, key);

  await auditLog(agent, "read", key);

  return row;
}

// ── Delete ───────────────────────────────────────────────────────────

export async function deleteMemory(
  key: string,
  agentId?: string,
): Promise<{ key: string; deleted: boolean }> {
  const agent = resolveAgentId(agentId);

  await getMemoryPool()!.query(
    `UPDATE memory.memories SET is_deleted = TRUE WHERE agent_id = $1 AND key = $2`,
    [agent, key],
  );
  await auditLog(agent, "delete", key);

  return { key, deleted: true };
}
