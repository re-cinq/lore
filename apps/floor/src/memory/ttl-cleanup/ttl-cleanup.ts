import { query } from "../../kernel/db.js";

export async function ttlCleanupJob(): Promise<string> {
  const result = await query<{ count: string }>(
    `WITH expired AS (
       UPDATE memory.memories
       SET is_deleted = true
       WHERE expires_at IS NOT NULL
         AND expires_at < now()
         AND is_deleted = false
       RETURNING id
     )
     SELECT count(*)::text AS count FROM expired`,
  );

  const count = parseInt(result[0]?.count || "0", 10);

  if (count > 0) {
    console.log(`[job] ttl-cleanup: removed ${count} expired memories`);
  }

  return `Cleaned up ${count} expired memories`;
}
