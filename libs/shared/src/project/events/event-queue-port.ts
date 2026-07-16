import type { EventInsert } from "../../events.js";

export type { EventInsert };

/**
 * A claimed `pipeline.events` row (layer 2 of the Floor event bus). `id` is the
 * bigint serialized as a string by pg; `repo` is denormalized from `params.repo`
 * (NULL for org-wide cron/k8s events).
 */
export interface EventRow {
  id: string;
  event_name: string;
  source: string;
  params: Record<string, unknown>;
  repo: string | null;
  dedupe_key: string | null;
  status: string;
  attempts: number;
  error: string | null;
  captured_at: string;
  claimed_at: string | null;
  next_attempt_at: string;
  handled_at: string | null;
}

/**
 * The `pipeline.events` queue mechanics: producers insert (idempotent on
 * `dedupe_key`); the loop atomically claims a batch and transitions each row
 * done/failed/dead; the reaper recovers crash-stuck rows and prunes terminal
 * ones. Single-sourced here so the event-bus SQL has one home; the Floor loop,
 * registry, and scheduler keep their orchestration.
 */
export interface EventQueueRepository {
  /** Insert one event, collapsing a redelivery when `dedupeKey` is set. */
  insert(input: EventInsert): Promise<void>;
  /**
   * Atomically claim up to `limit` runnable rows (pending/failed past
   * backoff). `excludeEventNames` skips busy serial families at claim time so
   * their waiting rows stay `pending` — parking them in `processing` behind an
   * in-process queue would get them reaped as presumed-dead and re-run
   * concurrently anyway.
   */
  claimBatch(limit: number, excludeEventNames?: string[]): Promise<EventRow[]>;
  markDone(id: string): Promise<void>;
  markFailed(id: string, error: string, backoffSeconds: number): Promise<void>;
  markDead(id: string, error: string): Promise<void>;
  /** Reset rows stuck in `processing` past `timeoutSeconds`; returns the count. */
  reapStuck(timeoutSeconds: number): Promise<number>;
  /** Delete terminal rows older than `olderThanDays`; returns the count. */
  pruneHandled(olderThanDays: number): Promise<number>;
}
