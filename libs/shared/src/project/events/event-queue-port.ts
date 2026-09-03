import type { Assert, KeysAreColumns } from "../../lib/row.js";
import { EVENT_COLUMNS, type Event } from "../../models/event.js";
import type { EventInsert } from "../../events.js";

export type { EventInsert };

/** A claimed `pipeline.events` row (layer 2 of the Floor event bus); `repo` is denormalized from `params.repo` (NULL for org-wide cron/k8s events). */
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

/** The `pipeline.events` queue mechanics: insert (idempotent on `dedupe_key`), claim/transition, reap/prune. Single-sourced here; the Floor loop/registry/scheduler keep their orchestration. */
/** The producer half, alone — after ADR-044 a producer may not even hold a pool, so its dependency says "somewhere to report", not "the queue". */
export type EventReporter = Pick<EventQueueRepository, "insert">;

export interface EventQueueRepository {
  /** Insert one event, collapsing a redelivery when `dedupeKey` is set. */
  insert(input: EventInsert): Promise<void>;
  /** Atomically claim up to `limit` runnable rows; `excludeEventNames` skips busy serial families so their waiting rows stay `pending` rather than get reaped and re-run concurrently. */
  claimBatch(limit: number, excludeEventNames?: string[]): Promise<EventRow[]>;
  markDone(id: string): Promise<void>;
  markFailed(id: string, error: string, backoffSeconds: number): Promise<void>;
  markDead(id: string, error: string): Promise<void>;
  /** Reset rows stuck in `processing` past `timeoutSeconds`; returns the count. */
  reapStuck(timeoutSeconds: number): Promise<number>;
  /** Delete terminal rows older than `olderThanDays`; returns the count. */
  pruneHandled(olderThanDays: number): Promise<number>;
}

/** `EventRow` is the `Event` MODEL in the stored spelling; every key it declares is asserted at compile time to be a column of `pipeline.events`. */
type _EventRowKeysAreColumns = Assert<
  KeysAreColumns<EventRow, Event, typeof EVENT_COLUMNS>
>;
