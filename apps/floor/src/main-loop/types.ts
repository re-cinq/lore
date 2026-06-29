/**
 * Shared types for the Floor event bus. An `EventInput` is what a listener
 * (layer 1) inserts; an `EventRow` is what the loop (layer 2) claims; an
 * `EventHandler` is a task/job (layer 3) keyed by event_name in the registry.
 */

import type { EventSource } from "./event-names.js";

export interface EventInput {
  eventName: string;
  source: EventSource;
  params?: Record<string, unknown>;
  /** Idempotency key; insert is ON CONFLICT DO NOTHING when set. */
  dedupeKey?: string;
}

export interface EventRow {
  id: string; // bigint → string from pg
  event_name: string;
  source: string;
  params: Record<string, unknown>;
  repo: string | null; // denormalized from params.repo; NULL for cron/k8s events
  dedupe_key: string | null;
  status: string;
  attempts: number;
  error: string | null;
  captured_at: string;
  claimed_at: string | null;
  next_attempt_at: string;
  handled_at: string | null;
}

/** A layer-3 handler. Self-sources its own deps (DB pool, platform); params carry the event payload. */
export type EventHandler = (params: Record<string, unknown>) => Promise<void>;
