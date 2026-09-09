import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `pipeline.events` — the Floor's trigger substrate (ADR-015 amendment, ADR-044): listeners only insert, and every consumer drains its own `pipeline.event_deliveries` row rather than this one. `id` is a string-encoded bigint doubling as a cursor, never narrowed to a JS number. */

export const EventSchema = z.object({
  id: z.string(),
  eventName: z.string(),
  source: z.string(),
  repo: z.string().nullable(),
  params: z.record(z.string(), z.unknown()),
  dedupeKey: z.string().nullable(),
  capturedAt: z.date(),
});

export type Event = z.infer<typeof EventSchema>;

export const EVENT_COLUMNS = {
  id: "id",
  eventName: "event_name",
  source: "source",
  repo: "repo",
  params: "params",
  dedupeKey: "dedupe_key",
  capturedAt: "captured_at",
} as const satisfies ColumnMap<Event>;

export const EVENT_TABLE = "pipeline.events";
