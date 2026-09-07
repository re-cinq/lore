import {
  DEFAULT_TTL_SEC,
  leaseSpan,
  acquiredResult,
  type LeasePool,
  type LeaseBackend,
  type AcquireResult,
  type ExpiredLease,
} from "./lease-port.js";

/** Whether a write actually touched a row — `rowCount` is `null` for statements that never report a count. */
function hadEffect(result: { rowCount: number | null }): boolean {
  return (result.rowCount ?? 0) > 0;
}

function previousHolderOf(
  rows: { previous_holder: string | null }[],
): string | undefined {
  return rows[0]?.previous_holder ?? undefined;
}

function currentHolderOf(rows: { holder: string }[]): string | undefined {
  return rows[0]?.holder;
}

/** Postgres-backed {@link LeaseBackend}: atomic upsert-with-takeover-detection via one CTE. */
/** One statement, and the CTE is load-bearing: it captures the PRIOR holder before the upsert overwrites it, which is what makes a takeover auditable (#T027). The `WHERE expires_at < now()` on the DO UPDATE is the lease itself — an unexpired lease matches nothing, the statement reports no effect, and the caller is rejected rather than silently stealing the branch. */
const ACQUIRE_SQL = `WITH prev AS (
             SELECT holder AS prev_holder
               FROM pipeline.task_leases
              WHERE branch_name = $1
           )
           INSERT INTO pipeline.task_leases (branch_name, task_id, holder, expires_at)
           VALUES ($1, $2, $3, now() + ($4::int || ' seconds')::interval)
           ON CONFLICT (branch_name) DO UPDATE
             SET task_id     = EXCLUDED.task_id,
                 holder      = EXCLUDED.holder,
                 acquired_at = now(),
                 expires_at  = EXCLUDED.expires_at
             WHERE pipeline.task_leases.expires_at < now()
           RETURNING (SELECT prev_holder FROM prev) AS previous_holder`;

export class DbLeaseBackend implements LeaseBackend {
  constructor(private readonly pool: LeasePool) {}

  async acquire(
    branchName: string,
    taskId: string | null,
    holder: string,
    ttlSec: number = DEFAULT_TTL_SEC,
  ): Promise<AcquireResult> {
    return await leaseSpan(
      "acquire",
      { backend: "db", branchName, taskId: taskId ?? "", holder, ttlSec },
      async (span) => {
        const result = await this.pool.query<{
          previous_holder: string | null;
        }>(ACQUIRE_SQL, [branchName, taskId, holder, ttlSec]);

        if (hadEffect(result)) {
          return acquiredResult(span, previousHolderOf(result.rows));
        }

        const cur = await this.pool.query<{ holder: string }>(
          `SELECT holder FROM pipeline.task_leases WHERE branch_name = $1`,
          [branchName],
        );
        const currentHolder = currentHolderOf(cur.rows);

        span.setAttribute("outcome", "rejected");

        if (currentHolder) {
          span.setAttribute("current_holder", currentHolder);
        }

        return { acquired: false, currentHolder };
      },
    );
  }

  async refresh(
    branchName: string,
    holder: string,
    ttlSec: number = DEFAULT_TTL_SEC,
    phase?: string,
  ): Promise<boolean> {
    return await leaseSpan(
      "refresh",
      { backend: "db", branchName, holder, ttlSec, phase },
      async (span) => {
        const result = await this.pool.query(
          `UPDATE pipeline.task_leases
              SET expires_at = now() + ($2::int || ' seconds')::interval,
                  phase      = COALESCE($3, phase)
            WHERE branch_name = $1 AND holder = $4`,
          [branchName, ttlSec, phase ?? null, holder],
        );
        const refreshed = (result.rowCount ?? 0) > 0;

        span.setAttribute("outcome", refreshed ? "refreshed" : "not_held");

        return refreshed;
      },
    );
  }

  async release(branchName: string, holder: string): Promise<boolean> {
    return await leaseSpan(
      "release",
      { backend: "db", branchName, holder },
      async (span) => {
        const result = await this.pool.query(
          `DELETE FROM pipeline.task_leases
            WHERE branch_name = $1 AND holder = $2`,
          [branchName, holder],
        );
        const released = (result.rowCount ?? 0) > 0;

        span.setAttribute("outcome", released ? "released" : "not_held");

        return released;
      },
    );
  }

  async reapExpired(cutoff: Date): Promise<ExpiredLease[]> {
    return await leaseSpan("reap", { backend: "db" }, async (span) => {
      const result = await this.pool.query<ExpiredLease>(
        `DELETE FROM pipeline.task_leases
            WHERE expires_at < $1
          RETURNING branch_name, task_id, holder, expires_at`,
        [cutoff],
      );

      span.setAttribute("reaped_count", result.rows.length);

      return result.rows;
    });
  }
}
