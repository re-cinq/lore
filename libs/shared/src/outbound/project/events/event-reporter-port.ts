import type { Assert, KeysAreColumns } from "../../../lib/row.js";
import { EVENT_COLUMNS, type Event } from "../../../domain/models/event.js";
import type { EventInsert } from "../../events.js";

export type { EventInsert };

/** A captured `pipeline.events` row; `repo` is denormalized from `params.repo` (NULL for org-wide cron/k8s events). Consumption happens on `pipeline.event_deliveries`, never here. */
export interface EventRow {
  id: string;
  event_name: string;
  source: string;
  params: Record<string, unknown>;
  repo: string | null;
  dedupe_key: string | null;
  captured_at: string;
}

/** The producer's whole dependency: somewhere to report. After ADR-044 a producer may not even hold a pool. */
export interface EventReporter {
  /** Insert one event, collapsing a redelivery when `dedupeKey` is set. */
  insert(input: EventInsert): Promise<void>;
}

/** `EventRow` is the `Event` MODEL in the stored spelling; every key it declares is asserted at compile time to be a column of `pipeline.events`. */
type _EventRowKeysAreColumns = Assert<
  KeysAreColumns<EventRow, Event, typeof EVENT_COLUMNS>
>;
