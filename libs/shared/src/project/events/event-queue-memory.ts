import { eventRepo, type EventInsert } from "../../events.js";
import type { EventQueueRepository, EventRow } from "./event-queue-port.js";

const MAX_ERROR_LEN = 2000;
const at = (ms: number): string => new Date(ms).toISOString();

/**
 * In-memory {@link EventQueueRepository}: the behavioral spec of the Pg adapter
 * over an array of rows. `now` is injectable so backoff/visibility windows are
 * deterministic in tests. Lets the loop + reaper be tested without a live DB.
 */
export class InMemoryEventQueue implements EventQueueRepository {
  private seq = 0;

  constructor(
    public rows: EventRow[] = [],
    private readonly now: () => number = () => Date.now(),
  ) {}

  async insert(input: EventInsert): Promise<void> {
    if (input.dedupeKey && this.rows.some((r) => r.dedupe_key === input.dedupeKey)) {
      return;
    }
    const iso = at(this.now());
    this.rows.push({
      id: String(++this.seq),
      event_name: input.eventName,
      source: input.source,
      params: input.params ?? {},
      repo: eventRepo(input.params),
      dedupe_key: input.dedupeKey ?? null,
      status: "pending",
      attempts: 0,
      error: null,
      captured_at: iso,
      claimed_at: null,
      next_attempt_at: iso,
      handled_at: null,
    });
  }

  async claimBatch(limit: number): Promise<EventRow[]> {
    const now = this.now();
    const claimable = this.rows
      .filter(
        (r) =>
          (r.status === "pending" || r.status === "failed") &&
          new Date(r.next_attempt_at).getTime() <= now,
      )
      .sort((a, b) => {
        const an = new Date(a.next_attempt_at).getTime();
        const bn = new Date(b.next_attempt_at).getTime();
        return an !== bn ? an - bn : Number(a.id) - Number(b.id);
      })
      .slice(0, limit);
    const iso = at(now);
    for (const r of claimable) {
      r.status = "processing";
      r.attempts += 1;
      r.claimed_at = iso;
    }
    return claimable;
  }

  async markDone(id: string): Promise<void> {
    this.mutate(id, (r) => {
      r.status = "done";
      r.handled_at = at(this.now());
    });
  }

  async markFailed(id: string, error: string, backoffSeconds: number): Promise<void> {
    this.mutate(id, (r) => {
      r.status = "failed";
      r.error = error.slice(0, MAX_ERROR_LEN);
      r.next_attempt_at = at(this.now() + backoffSeconds * 1000);
    });
  }

  async markDead(id: string, error: string): Promise<void> {
    this.mutate(id, (r) => {
      r.status = "dead";
      r.error = error.slice(0, MAX_ERROR_LEN);
      r.handled_at = at(this.now());
    });
  }

  async reapStuck(timeoutSeconds: number): Promise<number> {
    const cutoff = this.now() - timeoutSeconds * 1000;
    const stuck = this.rows.filter(
      (r) =>
        r.status === "processing" &&
        r.claimed_at != null &&
        new Date(r.claimed_at).getTime() < cutoff,
    );
    for (const r of stuck) {
      r.status = "failed";
      r.next_attempt_at = at(this.now());
    }
    return stuck.length;
  }

  async pruneHandled(olderThanDays: number): Promise<number> {
    const cutoff = this.now() - olderThanDays * 86_400_000;
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) =>
        !(
          (r.status === "done" || r.status === "dead") &&
          r.handled_at != null &&
          new Date(r.handled_at).getTime() < cutoff
        ),
    );
    return before - this.rows.length;
  }

  private mutate(id: string, fn: (row: EventRow) => void): void {
    const row = this.rows.find((r) => r.id === id);
    if (row) fn(row);
  }
}
