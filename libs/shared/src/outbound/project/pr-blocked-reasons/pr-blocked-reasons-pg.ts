import type { BlockedReason } from "../../../domain/blocked-reason.js";
import type { PgPool } from "../../memory-store.js";
import type { PrBlockedReasonsPort } from "./pr-blocked-reasons-port.js";

const OPEN_ROW = "repo = $1 AND pr_number = $2 AND closed_at IS NULL";

/** Postgres-backed PrBlockedReasonsPort over `pipeline.pr_blocked_reasons`. */
export class PgPrBlockedReasons implements PrBlockedReasonsPort {
  constructor(private readonly pool: PgPool) {}

  async current(repo: string, prNumber: number): Promise<BlockedReason | null> {
    const { rows } = await this.pool.query<BlockedReason>(
      `SELECT reason, detail FROM pipeline.pr_blocked_reasons WHERE ${OPEN_ROW}`,
      [repo, prNumber],
    );

    return rows[0] ? { reason: rows[0].reason, detail: rows[0].detail } : null;
  }

  async record(
    repo: string,
    prNumber: number,
    blocked: BlockedReason,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.pr_blocked_reasons AS r (repo, pr_number, reason, detail)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (repo, pr_number) DO UPDATE SET
         since = CASE WHEN r.reason IS DISTINCT FROM EXCLUDED.reason
                        OR r.closed_at IS NOT NULL
                      THEN now() ELSE r.since END,
         reason = EXCLUDED.reason,
         detail = EXCLUDED.detail,
         updated_at = now(),
         closed_at = NULL`,
      [repo, prNumber, blocked.reason, blocked.detail],
    );
  }

  async clear(repo: string, prNumber: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM pipeline.pr_blocked_reasons WHERE ${OPEN_ROW}`,
      [repo, prNumber],
    );
  }

  async close(repo: string, prNumber: number): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.pr_blocked_reasons SET closed_at = now() WHERE ${OPEN_ROW}`,
      [repo, prNumber],
    );
  }
}
