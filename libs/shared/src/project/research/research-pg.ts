import type { PgPool } from "../../memory-store.js";
import type { ResearchPort, ResearchAttempt } from "./research-port.js";

/**
 * Postgres-backed {@link ResearchPort}: a single INSERT into
 * `pipeline.research_attempts`. Lifted from the autoresearch job so it reaches
 * the research trail through the Project facade.
 */
export class PgResearch implements ResearchPort {
  constructor(private readonly pool: PgPool) {}

  async recordAttempt(row: ResearchAttempt): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.research_attempts (cluster_id, namespace, approach, content, eval_score, delta)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.clusterId,
        row.namespace,
        row.approach,
        row.content,
        row.evalScore,
        row.delta,
      ],
    );
  }
}
