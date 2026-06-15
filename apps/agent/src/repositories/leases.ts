import { query } from "../platform/db.js";

export interface ExpiredLease {
  branch_name: string;
  task_id: string;
  holder: string;
  /** Postgres returns a Date; widened to tolerate the reaper's string guard. */
  expires_at: Date | string;
}

export interface LeaseRepository {
  /** Deletes every lease whose `expires_at` is before `cutoff`, returning them. */
  deleteExpired(cutoff: Date): Promise<ExpiredLease[]>;
}

export class PgLeaseRepository implements LeaseRepository {
  async deleteExpired(cutoff: Date): Promise<ExpiredLease[]> {
    return await query<ExpiredLease>(
      `DELETE FROM pipeline.task_leases
        WHERE expires_at < $1
      RETURNING branch_name, task_id, holder, expires_at`,
      [cutoff],
    );
  }
}

/** In-memory test double seeded with leases; mirrors the `< cutoff` filter. */
export class InMemoryLeaseRepository implements LeaseRepository {
  constructor(public leases: ExpiredLease[] = []) {}

  async deleteExpired(cutoff: Date): Promise<ExpiredLease[]> {
    const isExpired = (lease: ExpiredLease) =>
      !(lease.expires_at instanceof Date) || lease.expires_at.getTime() < cutoff.getTime();
    const expired = this.leases.filter(isExpired);
    this.leases = this.leases.filter((lease) => !isExpired(lease));
    return expired;
  }
}
