import type { Pool } from "pg";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { trace, type Tracer } from "@opentelemetry/api";

const DEFAULT_TTL_SEC = 600;

const tracer: Tracer = trace.getTracer("lore.lease");

export interface AcquireResult {
  acquired: boolean;
  currentHolder?: string;
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
  acquire(
    branchName: string,
    taskId: string,
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
}

export class DbLeaseBackend implements LeaseBackend {
  constructor(private readonly pool: Pool) {}

  async acquire(
    branchName: string,
    taskId: string,
    holder: string,
    ttlSec: number = DEFAULT_TTL_SEC,
  ): Promise<AcquireResult> {
    return await tracer.startActiveSpan("lore.lease.acquire", async (span) => {
      span.setAttribute("branch_name", branchName);
      span.setAttribute("task_id", taskId);
      span.setAttribute("holder", holder);
      span.setAttribute("ttl_sec", ttlSec);
      span.setAttribute("backend", "db");
      try {
        const result = await this.pool.query<{ holder: string }>(
          `INSERT INTO pipeline.task_leases (branch_name, task_id, holder, expires_at)
           VALUES ($1, $2, $3, now() + ($4::int || ' seconds')::interval)
           ON CONFLICT (branch_name) DO UPDATE
             SET task_id     = EXCLUDED.task_id,
                 holder      = EXCLUDED.holder,
                 acquired_at = now(),
                 expires_at  = EXCLUDED.expires_at
             WHERE pipeline.task_leases.expires_at < now()
           RETURNING holder`,
          [branchName, taskId, holder, ttlSec],
        );

        if ((result.rowCount ?? 0) > 0) {
          span.setAttribute("outcome", "acquired");
          return { acquired: true };
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
}

interface FileLeaseRecord {
  branch_name: string;
  task_id: string;
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
    taskId: string,
    holder: string,
    ttlSec: number = DEFAULT_TTL_SEC,
  ): Promise<AcquireResult> {
    return await tracer.startActiveSpan("lore.lease.acquire", async (span) => {
      span.setAttribute("branch_name", branchName);
      span.setAttribute("task_id", taskId);
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

        await this.writeRecord({
          branch_name: branchName,
          task_id: taskId,
          holder,
          acquired_at: new Date(now).toISOString(),
          expires_at: new Date(now + ttlSec * 1000).toISOString(),
        });
        span.setAttribute("outcome", "acquired");
        return { acquired: true };
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
}
