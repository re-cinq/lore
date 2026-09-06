import type { ExpiredLease, LeaseReaper } from "./lease-port.js";

export { DbLeaseBackend } from "./lease-backend-db.js";
export { FileLeaseBackend } from "./lease-backend-file.js";
export {
  DEFAULT_TTL_SEC,
  tracer,
  EXPIRED_LEASE_SHAPE,
  acquiredResult,
  type LeasePool,
  type LeaseBackend,
  type AcquireResult,
  type ExpiredLease,
  type LeaseReaper,
} from "./lease-port.js";

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
