import * as fs from "node:fs/promises";
import * as path from "node:path";
import { trace, type Tracer } from "@opentelemetry/api";

/**
 * The narrow Postgres surface {@link DbLeaseBackend} needs — `query` returning
 * `rowCount` so the CTE/UPSERT outcome can be read. A real `pg.Pool` satisfies
 * this structurally; keeping it local means shared never imports `pg`.
 */
export interface LeasePool {
  query<R = unknown>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

const DEFAULT_TTL_SEC = 600;

const tracer: Tracer = trace.getTracer("lore.lease");

/**
 * A lease the reaper swept because its `expires_at` was past the cutoff.
 * `expires_at` is widened to tolerate both a pg `Date` and a serialized string.
 */
export interface ExpiredLease {
  branch_name: string;
  /** Null for task-less runs (detection assembly lines). */
  task_id: string | null;
  holder: string;
  expires_at: Date | string;
}

export interface AcquireResult {
  acquired: boolean;
  /**
   * Set when `acquired === false`. The holder of the still-valid lease
   * the caller should yield to.
   */
  currentHolder?: string;
  /**
   * Set when `acquired === true` AND the acquire was a takeover from an
   * expired prior holder. The supervisor uses this to emit a
   * `lease_expired` audit entry naming the previous holder (T027).
   * `undefined` when the acquire was a fresh insert with no prior row.
   */
  tookOverFrom?: string;
}

/**
 * Single supervisor lease abstraction. Two implementations:
 *  - {@link DbLeaseBackend} — the canonical Postgres-backed lease used by
 *    cluster supervisors (FR1.6, Q4 clarification).
 *  - {@link FileLeaseBackend} — file-system fallback for the local runner
 *    when no `LORE_DB_HOST` is configured.
 *
 * The supervisor selects a backend at startup; downstream code never
 * needs to know which is in use.
 */
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

  /**
   * Janitor sweep: remove every lease whose `expires_at` is before `cutoff`,
   * returning the swept rows so the caller can audit each takeover. Used by the
   * lease-reaper (org-wide, no repo in scope).
   */
  reapExpired(cutoff: Date): Promise<ExpiredLease[]>;
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
        // The CTE captures the previous holder (if any) so a takeover
        // from an expired prior pod can be reported and audited (T027).
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

        if ((result.rowCount ?? 0) > 0) {
          const tookOverFrom =
            result.rows[0]?.previous_holder ?? undefined;
          span.setAttribute(
            "outcome",
            tookOverFrom ? "takeover" : "acquired",
          );
          if (tookOverFrom) span.setAttribute("took_over_from", tookOverFrom);
          return tookOverFrom
            ? { acquired: true, tookOverFrom }
            : { acquired: true };
        }

        const cur = await this.pool.query<{ holder: string }>(
          `SELECT holder FROM pipeline.task_leases WHERE branch_name = $1`,
          [branchName],
        );
        const currentHolder = cur.rows[0]?.holder;
        span.setAttribute("outcome", "rejected");
        if (currentHolder) span.setAttribute("current_holder", currentHolder);
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
      if (phase) span.setAttribute("phase", phase);
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
  acquired_at: string; // ISO8601
  expires_at: string;  // ISO8601
  phase?: string;
}

export class FileLeaseBackend implements LeaseBackend {
  constructor(private readonly leasesDir: string) {}

  private filename(branchName: string): string {
    // Branch names contain slashes (e.g. "lore/feature/foo"); URL-encode
    // so each lease lands as a single flat file.
    return path.join(this.leasesDir, encodeURIComponent(branchName) + ".json");
  }

  private async readRecord(branchName: string): Promise<FileLeaseRecord | null> {
    try {
      const raw = await fs.readFile(this.filename(branchName), "utf-8");
      return JSON.parse(raw) as FileLeaseRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
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
        const expired =
          !existing || new Date(existing.expires_at).getTime() < now;

        if (existing && !expired) {
          span.setAttribute("outcome", "rejected");
          span.setAttribute("current_holder", existing.holder);
          return { acquired: false, currentHolder: existing.holder };
        }

        const tookOverFrom = existing?.holder;
        await this.writeRecord({
          branch_name: branchName,
          task_id: taskId,
          holder,
          acquired_at: new Date(now).toISOString(),
          expires_at: new Date(now + ttlSec * 1000).toISOString(),
        });
        span.setAttribute(
          "outcome",
          tookOverFrom ? "takeover" : "acquired",
        );
        if (tookOverFrom) span.setAttribute("took_over_from", tookOverFrom);
        return tookOverFrom
          ? { acquired: true, tookOverFrom }
          : { acquired: true };
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
      if (phase) span.setAttribute("phase", phase);
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
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw err;
        }
        const reaped: ExpiredLease[] = [];
        for (const entry of entries) {
          const rec = await this.readRecord(decodeURIComponent(entry.replace(/\.json$/, "")));
          if (!rec || new Date(rec.expires_at).getTime() >= cutoff.getTime()) continue;
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

/**
 * In-memory {@link LeaseReaper}: seeded with leases, removes and returns those
 * before the cutoff. The double for the lease-reaper job (relocated from the
 * Floor kernel so it stays a unit with the Db/File reap semantics).
 */
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
