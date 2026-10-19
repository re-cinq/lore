import type { BlockedReason } from "../../../domain/blocked-reason.js";
import type { PrBlockedReasonsPort } from "./pr-blocked-reasons-port.js";

export interface PrBlockedReasonRow extends BlockedReason {
  since: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

/** In-memory PrBlockedReasonsPort, the behavioral spec of the pg adapter; rows are keyed `repo#number`. */
export class InMemoryPrBlockedReasons implements PrBlockedReasonsPort {
  readonly rows = new Map<string, PrBlockedReasonRow>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async current(repo: string, prNumber: number): Promise<BlockedReason | null> {
    const row = this.openRow(repo, prNumber);

    return row ? { reason: row.reason, detail: row.detail } : null;
  }

  async record(
    repo: string,
    prNumber: number,
    blocked: BlockedReason,
  ): Promise<void> {
    const at = this.now();
    const earlier = this.openRow(repo, prNumber);
    const since = earlier?.reason === blocked.reason ? earlier.since : at;

    this.rows.set(keyOf(repo, prNumber), {
      ...blocked,
      since,
      updatedAt: at,
      closedAt: null,
    });
  }

  async clear(repo: string, prNumber: number): Promise<void> {
    if (this.openRow(repo, prNumber)) {
      this.rows.delete(keyOf(repo, prNumber));
    }
  }

  async close(repo: string, prNumber: number): Promise<void> {
    const row = this.openRow(repo, prNumber);

    if (row) {
      row.closedAt = this.now();
    }
  }

  private openRow(
    repo: string,
    prNumber: number,
  ): PrBlockedReasonRow | undefined {
    const row = this.rows.get(keyOf(repo, prNumber));

    return row?.closedAt === null ? row : undefined;
  }
}

const keyOf = (repo: string, prNumber: number): string => `${repo}#${prNumber}`;
