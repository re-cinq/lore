import type { PgPool } from "../../memory-store.js";
import type { ContextCorePort, ContextCoreRecord } from "./context-core-port.js";

/**
 * Postgres-backed {@link ContextCorePort}: the latest-production read and the
 * append INSERT lifted byte-for-byte from the Floor's context-core-builder.
 */
export class PgContextCore implements ContextCorePort {
  constructor(private readonly pool: PgPool) {}

  async latest(namespace: string): Promise<number | null> {
    const { rows } = await this.pool.query(
      `SELECT eval_score FROM pipeline.context_core_history
     WHERE namespace = $1 AND status = 'production'
     ORDER BY promoted_at DESC
     LIMIT 1`,
      [namespace],
    );
    const row = rows[0] as { eval_score: number } | undefined;
    return row?.eval_score ?? null;
  }

  async insert(record: ContextCoreRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.context_core_history (version, namespace, eval_score, status)
       VALUES ($1, $2, $3, $4)`,
      [record.version, record.namespace, record.evalScore, record.status],
    );
  }
}
