import type { PgPool } from "../../memory-store.js";
import { insertEvent, type EventInsert } from "../../events.js";
import type { EventReporter } from "./event-reporter-port.js";

/** Postgres-backed EventReporter over the shared insertEvent writer (idempotent on `dedupe_key`, fans out to every subscriber in the same statement). */
export class PgEventReporter implements EventReporter {
  constructor(private readonly pool: PgPool) {}

  insert(input: EventInsert): Promise<void> {
    return insertEvent(this.pool, input);
  }
}
