import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Span } from "@opentelemetry/api";
import {
  TaskLeaseSchema,
  TASK_LEASE_COLUMNS,
} from "../../../domain/models/task-lease.js";
import type { WireOf } from "../../../lib/wire-schema.js";
import {
  DEFAULT_TTL_SEC,
  leaseSpan,
  acquiredResult,
  type LeaseBackend,
  type AcquireResult,
  type ExpiredLease,
} from "./lease-port.js";

/** The on-disk JSON record for the File backend — same columns as the model, timestamps serialized as ISO strings instead of `Date`. */
type FileLeaseRecord = Omit<
  WireOf<typeof TaskLeaseSchema.shape, typeof TASK_LEASE_COLUMNS>,
  "acquired_at" | "expires_at" | "phase"
> & {
  acquired_at: string;
  expires_at: string;
  phase?: string;
};

type AcquireArgs = {
  branchName: string;
  taskId: string | null;
  holder: string;
  ttlSec: number;
};

type RefreshArgs = {
  branchName: string;
  holder: string;
  ttlSec: number;
  phase?: string;
};

/** The record written when a branch is taken, stamped at `now` so the acquire and its expiry share one clock reading. */
function newLeaseRecord(args: AcquireArgs, now: number): FileLeaseRecord {
  return {
    branch_name: args.branchName,
    task_id: args.taskId,
    holder: args.holder,
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + args.ttlSec * 1000).toISOString(),
  };
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

  private async takeLease(
    span: Span,
    args: AcquireArgs,
  ): Promise<AcquireResult> {
    const existing = await this.readRecord(args.branchName);
    const now = Date.now();
    const rejected = rejectedIfHeld(existing, now, span);

    if (rejected) {
      return rejected;
    }
    const tookOverFrom = existing?.holder;

    await this.writeRecord(newLeaseRecord(args, now));

    return acquiredResult(span, tookOverFrom);
  }

  async acquire(
    branchName: string,
    taskId: string | null,
    holder: string,
    ttlSec: number = DEFAULT_TTL_SEC,
  ): Promise<AcquireResult> {
    return await leaseSpan(
      "acquire",
      { backend: "file", branchName, taskId: taskId ?? "", holder, ttlSec },
      async (span) =>
        await this.takeLease(span, { branchName, taskId, holder, ttlSec }),
    );
  }

  private async refreshRecord(span: Span, args: RefreshArgs): Promise<boolean> {
    const existing = await this.readRecord(args.branchName);

    if (!existing || existing.holder !== args.holder) {
      span.setAttribute("outcome", "not_held");

      return false;
    }
    await this.writeRecord({
      ...existing,
      expires_at: new Date(Date.now() + args.ttlSec * 1000).toISOString(),
      ...(args.phase ? { phase: args.phase } : {}),
    });
    span.setAttribute("outcome", "refreshed");

    return true;
  }

  async refresh(
    branchName: string,
    holder: string,
    ttlSec: number = DEFAULT_TTL_SEC,
    phase?: string,
  ): Promise<boolean> {
    return await leaseSpan(
      "refresh",
      { backend: "file", branchName, holder, ttlSec, phase },
      async (span) =>
        await this.refreshRecord(span, { branchName, holder, ttlSec, phase }),
    );
  }

  async release(branchName: string, holder: string): Promise<boolean> {
    return await leaseSpan(
      "release",
      { backend: "file", branchName, holder },
      async (span) => {
        const existing = await this.readRecord(branchName);

        if (!existing || existing.holder !== holder) {
          span.setAttribute("outcome", "not_held");

          return false;
        }
        await fs.unlink(this.filename(branchName));
        span.setAttribute("outcome", "released");

        return true;
      },
    );
  }

  /** The lease files on disk, or none when the directory does not exist yet. A worktree that has never taken a lease has nothing to reap, which is not an error. */
  private async listLeaseFiles(): Promise<string[]> {
    try {
      return await fs.readdir(this.leasesDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /** Deletes one lease file when it expired before `cutoff`, returning what was swept, or null when it is still live. */
  private async reapFile(
    entry: string,
    cutoff: Date,
  ): Promise<ExpiredLease | null> {
    const rec = await this.readRecord(
      decodeURIComponent(entry.replace(/\.json$/, "")),
    );

    if (!rec || new Date(rec.expires_at).getTime() >= cutoff.getTime()) {
      return null;
    }
    await fs.unlink(path.join(this.leasesDir, entry));

    return {
      branch_name: rec.branch_name,
      task_id: rec.task_id,
      holder: rec.holder,
      expires_at: rec.expires_at,
    };
  }

  private async reapAll(span: Span, cutoff: Date): Promise<ExpiredLease[]> {
    const entries = await this.listLeaseFiles();
    const reaped: ExpiredLease[] = [];

    for (const entry of entries) {
      const lease = await this.reapFile(entry, cutoff);

      if (lease) {
        reaped.push(lease);
      }
    }
    span.setAttribute("reaped_count", reaped.length);

    return reaped;
  }

  async reapExpired(cutoff: Date): Promise<ExpiredLease[]> {
    return await leaseSpan(
      "reap",
      { backend: "file" },
      async (span) => await this.reapAll(span, cutoff),
    );
  }
}
