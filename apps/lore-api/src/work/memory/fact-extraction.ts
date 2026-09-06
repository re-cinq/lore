import type { PgPool } from "@re-cinq/lore-shared";
import { extractFacts } from "@re-cinq/lore-server-core/features/memory/facts.js";

/** Fact extraction for a just-written memory; resolves memory id and extracts facts (best-effort, never fails writes). */
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
