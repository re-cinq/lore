import type { LeaseBackend, AcquireResult, ExpiredLease } from "./lease-backends.js";

/**
 * project.leases — the branch-lease surface. Thin pass-through over the wired
 * {@link LeaseBackend} (Postgres in cluster mode, file-backed for the local
 * runner) so the supervisor coordinates branch ownership through the Project
 * facade instead of constructing a backend itself.
 */
export class Leases {
  constructor(private readonly backend: LeaseBackend) {}

  acquire(
    branchName: string,
    taskId: string,
    holder: string,
    ttlSec?: number,
  ): Promise<AcquireResult> {
    return this.backend.acquire(branchName, taskId, holder, ttlSec);
  }

  refresh(
    branchName: string,
    holder: string,
    ttlSec?: number,
    phase?: string,
  ): Promise<boolean> {
    return this.backend.refresh(branchName, holder, ttlSec, phase);
  }

  release(branchName: string, holder: string): Promise<boolean> {
    return this.backend.release(branchName, holder);
  }

  /** Sweep every lease past `cutoff`, returning the swept rows for auditing. */
  reapExpired(cutoff: Date): Promise<ExpiredLease[]> {
    return this.backend.reapExpired(cutoff);
  }
}
