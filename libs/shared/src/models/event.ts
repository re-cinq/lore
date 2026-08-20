import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.events` — the Floor's trigger substrate (ADR-015 amendment).
 *
 * DDL: migration `0023_pipeline_events.sql`, plus `repo` (0024). Listeners only
 * insert; the main loop claims runnable rows with `FOR UPDATE SKIP LOCKED` and
 * dispatches by `eventName`.
 *
 * `id` is a string-encoded bigint: the column is `GENERATED ALWAYS AS IDENTITY`
 * and doubles as a cursor, so it is never narrowed to a JS number.
 */

export const EventStatusSchema = z.enum([
  "pending",
  "processing",
  "done",
  "failed",
  "dead",
]);

export const EventSchema = z.object({
  id: z.string(),
  eventName: z.string(),
  source: z.string(),
  repo: z.string().nullable(),
  params: z.record(z.unknown()),
  dedupeKey: z.string().nullable(),
  status: EventStatusSchema,
  attempts: z.number(),
  error: z.string().nullable(),
  capturedAt: z.date(),
  claimedAt: z.date().nullable(),
  nextAttemptAt: z.date(),
  handledAt: z.date().nullable(),
});

export type EventStatus = z.infer<typeof EventStatusSchema>;
export type Event = z.infer<typeof EventSchema>;

export const EVENT_COLUMNS = {
  id: "id",
  eventName: "event_name",
  source: "source",
  repo: "repo",
  params: "params",
  dedupeKey: "dedupe_key",
  status: "status",
  attempts: "attempts",
  error: "error",
  capturedAt: "captured_at",
  claimedAt: "claimed_at",
  nextAttemptAt: "next_attempt_at",
  handledAt: "handled_at",
} as const satisfies ColumnMap<Event>;

export const EVENT_TABLE = "pipeline.events";
