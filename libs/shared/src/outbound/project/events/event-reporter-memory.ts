import { eventRepo, type EventInsert } from "../../events.js";
import type { EventReporter, EventRow } from "./event-reporter-port.js";

const at = (ms: number): string => new Date(ms).toISOString();

function capturedRow(id: string, input: EventInsert, iso: string): EventRow {
  return {
    id,
    event_name: input.eventName,
    source: input.source,
    params: input.params ?? {},
    repo: eventRepo(input.params),
    dedupe_key: input.dedupeKey ?? null,
    captured_at: iso,
  };
}

/** In-memory EventReporter: the behavioral spec of `insert`, with an injectable clock for deterministic tests. */
export class InMemoryEventReporter implements EventReporter {
  private seq = 0;

  constructor(
    public readonly rows: EventRow[] = [],
    private readonly now: () => number = () => Date.now(),
  ) {}

  async insert(input: EventInsert): Promise<void> {
    if (
      input.dedupeKey &&
      this.rows.some((r) => r.dedupe_key === input.dedupeKey)
    ) {
      return;
    }

    this.rows.push(capturedRow(String(++this.seq), input, at(this.now())));
  }
}
