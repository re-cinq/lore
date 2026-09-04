import * as fs from "node:fs/promises";
import * as path from "node:path";
import { trace, type Span, type Tracer } from "@opentelemetry/api";

/** Postgres interface for DbLeaseBackend (query + rowCount). */
export interface LeasePool {
  query<R = unknown>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

const DEFAULT_TTL_SEC = 600;

const tracer: Tracer = trace.getTracer("lore.lease");

/** Swept lease row with Date|string expires_at. */
export interface ExpiredLease {
  branch_name: string;
  /** Null for task-less runs (detection assembly lines). */
  task_id: string | null;
  holder: string;
  expires_at: Date | string;
}

export interface AcquireResult {
  acquired: boolean;
  /** Set when acquired === false; holder of the conflicting lease. */
  currentHolder?: string;
  /** Set on takeover from expired prior holder; undefined on fresh insert. */
  tookOverFrom?: string;
}

/** Supervisor lease abstraction with Db + File implementations. */
export interface LeaseBackend {
  /** `taskId` is null for task-less runs (detection assembly lines). */
  acquire(
    branchName: string,
    taskId: string | null,
    holder: string,
    ttlSec?: number,
  ): Promise<AcquireResult>;

  refresh(
    branchName: string,
    holder: string,
    ttlSec?: number,
    phase?: string,
  ): Promise<boolean>;

  release(branchName: string, holder: string): Promise<boolean>;

  /** Sweep expired leases (expires_at < cutoff) for audit. */
  reapExpired(cutoff: Date): Promise<ExpiredLease[]>;
}

/** Shape the result for a won upsert (takeover vs. fresh acquire). */
function acquiredResult(
  span: Span,
  tookOverFrom: string | undefined,
): AcquireResult {
  span.setAttribute("outcome", tookOverFrom ? "takeover" : "acquired");

  if (tookOverFrom) {
    span.setAttribute("took_over_from", tookOverFrom);
  }

  return tookOverFrom ? { acquired: true, tookOverFrom } : { acquired: true };
}

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

/** A rejected acquire result when `existing` is still live at `now`, else null so the caller proceeds to take it. */
function rejectedIfHeld(
  existing: FileLeaseRecord | null,
  now: number,
  span: Span,
): AcquireResult | null {
  if (!existing || new Date(existing.expires_at).getTime() < now) {
    return null;
  }
  span.setAttribute("outcome", "rejected");
  span.setAttribute("current_holder", existing.holder);

  return { acquired: false, currentHolder: existing.holder };
}

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

interface FileLeaseRecord {
  branch_name: string;
  task_id: string | null;
  holder: string;
  acquired_at: string;
  expires_at: string;
  phase?: string;
}

export class FileLeaseBackend implements LeaseBackend {
  constructor(private readonly leasesDir: string) {}

  private filename(branchName: string): string {
    // URL-encode branch names (contain slashes) to flat file names.
    return path.join(this.leasesDir, encodeURIComponent(branchName) + ".json");
  }

  private async readRecord(
    branchName: string,
  ): Promise<FileLeaseRecord | null> {
    try {
      const raw = await fs.readFile(this.filename(branchName), "utf-8");

      return JSON.parse(raw) as FileLeaseRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  private async writeRecord(rec: FileLeaseRecord): Promise<void> {
    await fs.mkdir(this.leasesDir, { recursive: true });
    await fs.writeFile(
      this.filename(rec.branch_name),
      JSON.stringify(rec, null, 2),
    );
  }

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
      span.setAttribute("backend", "file");

      try {
        const existing = await this.readRecord(branchName);
        const now = Date.now();
        const rejected = rejectedIfHeld(existing, now, span);

        if (rejected) {
          return rejected;
        }

        const tookOverFrom = existing?.holder;

        await this.writeRecord({
          branch_name: branchName,
          task_id: taskId,
          holder,
          acquired_at: new Date(now).toISOString(),
          expires_at: new Date(now + ttlSec * 1000).toISOString(),
        });

        return acquiredResult(span, tookOverFrom);
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
      span.setAttribute("backend", "file");

      if (phase) {
        span.setAttribute("phase", phase);
      }

      try {
        const existing = await this.readRecord(branchName);

        if (!existing || existing.holder !== holder) {
          span.setAttribute("outcome", "not_held");

          return false;
        }
        await this.writeRecord({
          ...existing,
          expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
          ...(phase ? { phase } : {}),
        });
        span.setAttribute("outcome", "refreshed");

        return true;
      } finally {
        span.end();
      }
    });
  }

  async release(branchName: string, holder: string): Promise<boolean> {
    return await tracer.startActiveSpan("lore.lease.release", async (span) => {
      span.setAttribute("branch_name", branchName);
      span.setAttribute("holder", holder);
      span.setAttribute("backend", "file");

      try {
        const existing = await this.readRecord(branchName);

        if (!existing || existing.holder !== holder) {
          span.setAttribute("outcome", "not_held");

          return false;
        }
        await fs.unlink(this.filename(branchName));
        span.setAttribute("outcome", "released");

        return true;
      } finally {
        span.end();
      }
    });
  }

  async reapExpired(cutoff: Date): Promise<ExpiredLease[]> {
    return await tracer.startActiveSpan("lore.lease.reap", async (span) => {
      span.setAttribute("backend", "file");

      try {
        let entries: string[];

        try {
          entries = await fs.readdir(this.leasesDir);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
          }
          throw err;
        }
        const reaped: ExpiredLease[] = [];

        for (const entry of entries) {
          const rec = await this.readRecord(
            decodeURIComponent(entry.replace(/\.json$/, "")),
          );

          if (!rec || new Date(rec.expires_at).getTime() >= cutoff.getTime()) {
            continue;
          }
          await fs.unlink(path.join(this.leasesDir, entry));
          reaped.push({
            branch_name: rec.branch_name,
            task_id: rec.task_id,
            holder: rec.holder,
            expires_at: rec.expires_at,
          });
        }
        span.setAttribute("reaped_count", reaped.length);

        return reaped;
      } finally {
        span.end();
      }
    });
  }
}

/** The narrow reap surface the lease-reaper depends on (DbLeaseBackend satisfies it). */
export interface LeaseReaper {
  reapExpired(cutoff: Date): Promise<ExpiredLease[]>;
}

/** In-memory {@link LeaseReaper}: behavioral spec double. */
export class InMemoryLeaseReaper implements LeaseReaper {
  constructor(public leases: ExpiredLease[] = []) {}

  async reapExpired(cutoff: Date): Promise<ExpiredLease[]> {
    const isExpired = (lease: ExpiredLease) =>
      !(lease.expires_at instanceof Date) ||
      lease.expires_at.getTime() < cutoff.getTime();
    const expired = this.leases.filter(isExpired);

    this.leases = this.leases.filter((lease) => !isExpired(lease));

    return expired;
  }
}
