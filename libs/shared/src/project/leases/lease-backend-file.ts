import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Span } from "@opentelemetry/api";
import {
  TaskLeaseSchema,
  TASK_LEASE_COLUMNS,
} from "../../models/task-lease.js";
import type { WireOf } from "../../lib/wire-schema.js";
import {
  DEFAULT_TTL_SEC,
  tracer,
  acquiredResult,
  type LeaseBackend,
  type AcquireResult,
  type ExpiredLease,
} from "./lease-backends.js";

/** The on-disk JSON record for the File backend — same columns as the model, timestamps serialized as ISO strings instead of `Date`. */
type FileLeaseRecord = Omit<
  WireOf<typeof TaskLeaseSchema.shape, typeof TASK_LEASE_COLUMNS>,
  "acquired_at" | "expires_at" | "phase"
> & {
  acquired_at: string;
  expires_at: string;
  phase?: string;
};

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

/** Worktree-mode {@link LeaseBackend}: one JSON file per branch under `~/.lore/leases/`. */
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
