import { query } from "../db.js";

export async function ttlCleanupJob(): Promise<string> {
  const result = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM memory.memories
       WHERE ttl_expires_at IS NOT NULL
         AND ttl_expires_at < now()
       RETURNING id
     )
     SELECT count(*)::text AS count FROM deleted`,
  );

  const count = parseInt(result[0]?.count || "0", 10);

  if (count > 0) {
    console.log(`[job] ttl-cleanup: removed ${count} expired memories`);
  }

  return `Cleaned up ${count} expired memories`;
}
