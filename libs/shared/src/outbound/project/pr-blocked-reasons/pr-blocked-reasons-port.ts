import type { BlockedReason } from "../../../domain/blocked-reason.js";

/** `pipeline.pr_blocked_reasons` (specs/protected-branch-merge): one row per open PR Lore watches, saying what blocks it. No row means nothing blocks the PR; a closed PR's row keeps its `closed_at` until the prune sweep removes it. */
export interface PrBlockedReasonsPort {
  /** The open PR's current reason; null when nothing blocks it or it is closed. */
  current(repo: string, prNumber: number): Promise<BlockedReason | null>;
  /** Upsert: `since` stays while the reason is unchanged and restarts when it changes; a closed row reopens. */
  record(repo: string, prNumber: number, blocked: BlockedReason): Promise<void>;
  /** Nothing blocks the open PR any more: its row goes. */
  clear(repo: string, prNumber: number): Promise<void>;
  /** The PR merged or closed: its open row is stamped with `closed_at`. */
  close(repo: string, prNumber: number): Promise<void>;
}
