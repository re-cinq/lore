import type { PgPool } from "@re-cinq/lore-shared";
import { extractFacts } from "@re-cinq/lore-server-core/features/memory/facts.js";

/**
 * Fact extraction for a just-written memory (`extract_facts: true`).
 *
 * `writeMemory` returns the key and version, not the row id, so the id is
 * resolved the same way the MCP tool used to before ADR-032 moved this work
 * server-side: newest version of that key for the repo or agent. Best-effort
 * throughout — a caller `void`s this, and a failure here must never surface as a
 * failed write.
 */
export async function extractFactsForMemory(
  pool: PgPool,
  memory: { key: string; value: string; agentId: string; repo?: string },
): Promise<void> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM memory.memories
       WHERE key = $1 AND (repo = $2 OR agent_id = $3)
       ORDER BY version DESC LIMIT 1`,
      [memory.key, memory.repo || "", memory.agentId],
    );

    if (!rows[0]?.id) {
      return;
    }
    await extractFacts(rows[0].id, memory.value, pool);
  } catch {
    /* best-effort: the memory is written either way */
  }
}
