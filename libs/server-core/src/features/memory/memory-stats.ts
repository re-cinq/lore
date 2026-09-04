import { resolveAgentId } from "../../platform/agent-id.js";
import { getMemoryPool } from "./memory.js";

// Health + usage diagnostics (PostgreSQL-backed) for one agent's memory store.

export async function agentHealth(agentId?: string) {
  const agent = resolveAgentId(agentId);
  const { rows } = await getMemoryPool()!.query(
    `
    SELECT count(*)::int as memory_count,
           max(created_at) as last_active,
           (SELECT count(*)::int FROM memory.snapshots WHERE agent_id = $1) as snapshot_count
    FROM memory.memories WHERE agent_id = $1 AND is_deleted = FALSE
  `,
    [agent],
  );

  return { agent_id: agent, ...rows[0] };
}

export async function agentStats(agentId?: string) {
  const agent = resolveAgentId(agentId);
  const { rows } = await getMemoryPool()!.query(
    `
    SELECT
      (SELECT count(*)::int FROM memory.memories WHERE agent_id = $1 AND is_deleted = FALSE) as total_memories,
      (SELECT count(*)::int FROM memory.facts f JOIN memory.memories m ON f.memory_id = m.id WHERE m.agent_id = $1) as total_facts,
      (SELECT count(*)::int FROM memory.facts f JOIN memory.memories m ON f.memory_id = m.id WHERE m.agent_id = $1 AND f.valid_to IS NULL) as active_facts,
      (SELECT count(*)::int FROM memory.facts f JOIN memory.memories m ON f.memory_id = m.id WHERE m.agent_id = $1 AND f.valid_to IS NOT NULL) as invalidated_facts,
      (SELECT count(*)::int FROM memory.audit_log WHERE agent_id = $1 AND operation = 'search') as total_searches,
      (SELECT count(DISTINCT name) FROM memory.shared_pools WHERE created_by = $1) as shared_pools_created
  `,
    [agent],
  );

  return { agent_id: agent, ...rows[0] };
}
