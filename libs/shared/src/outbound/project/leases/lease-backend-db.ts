import {
  DEFAULT_TTL_SEC,
  tracer,
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
export class DbLeaseBackend implements LeaseBackend {
  constructor(private readonly pool: LeasePool) {}

  async acquire(
    branchName: string,
    taskId: string | null,
    holder: string,
    ttlSec: number = DEFAULT_TTL_SEC,
  ): Promise<AcquireResult> {
    return await tracer.startActiveSpan("lore.lease.acquire", async (span) => {
      span.setAttribute("branch_name", branchName);
      span.setAttribute("task_id", taskId ?? "");
      span.setAttribute("holder", holder);
      span.setAttribute("ttl_sec", ttlSec);
      span.setAttribute("backend", "db");

      try {
        // CTE captures prior holder for takeover audit (#T027).
        const result = await this.pool.query<{
          previous_holder: string | null;
        }>(
          `WITH prev AS (
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
           RETURNING (SELECT prev_holder FROM prev) AS previous_holder`,
          [branchName, taskId, holder, ttlSec],
        );

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
      } finally {
        span.end();
      }
    });
  }

  async refresh(
    branchName: string,
    holder: string,
    ttlSec: number = DEFAULT_TTL_SEC,
    phase?: string,
  ): Promise<boolean> {
    return await tracer.startActiveSpan("lore.lease.refresh", async (span) => {
      span.setAttribute("branch_name", branchName);
      span.setAttribute("holder", holder);
      span.setAttribute("ttl_sec", ttlSec);
      span.setAttribute("backend", "db");

      if (phase) {
        span.setAttribute("phase", phase);
      }

      try {
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
      } finally {
        span.end();
      }
    });
  }

  async release(branchName: string, holder: string): Promise<boolean> {
    return await tracer.startActiveSpan("lore.lease.release", async (span) => {
      span.setAttribute("branch_name", branchName);
      span.setAttribute("holder", holder);
      span.setAttribute("backend", "db");

      try {
        const result = await this.pool.query(
          `DELETE FROM pipeline.task_leases
            WHERE branch_name = $1 AND holder = $2`,
          [branchName, holder],
        );
        const released = (result.rowCount ?? 0) > 0;

        span.setAttribute("outcome", released ? "released" : "not_held");

        return released;
      } finally {
        span.end();
      }
    });
  }

  async reapExpired(cutoff: Date): Promise<ExpiredLease[]> {
    return await tracer.startActiveSpan("lore.lease.reap", async (span) => {
      span.setAttribute("backend", "db");

      try {
        const result = await this.pool.query<ExpiredLease>(
          `DELETE FROM pipeline.task_leases
            WHERE expires_at < $1
          RETURNING branch_name, task_id, holder, expires_at`,
          [cutoff],
        );

        span.setAttribute("reaped_count", result.rows.length);

        return result.rows;
      } finally {
        span.end();
      }
    });
  }
}
