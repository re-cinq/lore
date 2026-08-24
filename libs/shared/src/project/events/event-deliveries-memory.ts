import { eventRepo, type EventInsert } from "../../events.js";
import type {
  EventDeliveriesPort,
  EventDeliveryRow,
  EventSubscription,
  OrphanedEvents,
} from "./event-deliveries-port.js";

const DEFAULT_VISIBILITY_SECONDS = 600;
const at = (ms: number): string => new Date(ms).toISOString();

interface StoredEvent {
  id: string;
  event_name: string;
  source: string;
  params: Record<string, unknown>;
  repo: string | null;
  dedupe_key: string | null;
  captured_at: string;
}

/**
 * In-memory {@link EventDeliveriesPort}: the behavioural spec of the Pg adapter
 * over two arrays. `now` is injectable so backoff and visibility windows are
 * deterministic. Fan-out happens inside `insert`, exactly as the SQL clause does
 * it on the other side — including producing nothing for a deduplicated event.
 */
export class InMemoryEventDeliveries implements EventDeliveriesPort {
  private eventSeq = 0;
  private deliverySeq = 0;

  constructor(
    public events: StoredEvent[] = [],
    public deliveries: EventDeliveryRow[] = [],
    public subscriptions: Map<string, Map<string, number>> = new Map(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async subscribe(
    subscriber: string,
    subscriptions: EventSubscription[],
  ): Promise<void> {
    // Replaces rather than merges: a boot registration declares the whole set,
    // so a name it omits is a handler that was removed. An empty set says
    // nothing at all, so as not to take a mis-booted subscriber off the bus.
    if (subscriptions.length === 0) {
      return;
    }

    this.subscriptions.set(
      subscriber,
      new Map(
        subscriptions.map((s) => [
          s.eventName,
          s.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_SECONDS,
        ]),
      ),
    );
  }

  async insert(input: EventInsert): Promise<void> {
    // Deduplicated insert => no event row => no deliveries, with no extra logic.
    if (
      input.dedupeKey &&
      this.events.some((e) => e.dedupe_key === input.dedupeKey)
    ) {
      return;
    }
    const iso = at(this.now());
    const event: StoredEvent = {
      id: String(++this.eventSeq),
      event_name: input.eventName,
      source: input.source,
      params: input.params ?? {},
      repo: eventRepo(input.params),
      dedupe_key: input.dedupeKey ?? null,
      captured_at: iso,
    };

    this.events.push(event);
    this.fanOut(event);
  }

  /**
   * One delivery per subscriber of this event, skipping any that already exists.
   *
   * Shared by the insert path and the boot reconcile so the two cannot disagree
   * about what a delivery looks like — the skip is what the store's
   * (event_id, subscriber) uniqueness gives the real adapter for free.
   */
  private fanOut(event: StoredEvent): number {
    let created = 0;

    for (const [subscriber, owned] of this.subscriptions) {
      const timeout = owned.get(event.event_name);
      const exists = this.deliveries.some(
        (d) => d.event_id === event.id && d.subscriber === subscriber,
      );

      if (timeout === undefined || exists) {
        continue;
      }
      created++;
      this.deliveries.push({
        id: String(++this.deliverySeq),
        event_id: event.id,
        subscriber,
        event_name: event.event_name,
        source: event.source,
        params: event.params,
        repo: event.repo,
        status: "pending",
        attempts: 0,
        error: null,
        claimed_at: null,
        next_attempt_at: event.captured_at,
        handled_at: null,
        visibility_timeout_seconds: timeout,
      });
    }

    return created;
  }

  async reconcileDeliveries(withinMinutes: number): Promise<number> {
    const since = this.now() - withinMinutes * 60_000;

    return this.events
      .filter((e) => Date.parse(e.captured_at) >= since)
      .reduce((created, e) => created + this.fanOut(e), 0);
  }

  async claim(
    subscriber: string,
    limit: number,
    excludeEventNames: string[] = [],
  ): Promise<EventDeliveryRow[]> {
    const now = this.now();
    const held = new Set(excludeEventNames);
    const runnable = this.deliveries
      .filter(
        (d) =>
          d.subscriber === subscriber &&
          !held.has(d.event_name) &&
          (d.status === "pending" || d.status === "failed") &&
          Date.parse(d.next_attempt_at) <= now,
      )
      .sort((a, b) =>
        a.next_attempt_at === b.next_attempt_at
          ? Number(a.id) - Number(b.id)
          : a.next_attempt_at < b.next_attempt_at
            ? -1
            : 1,
      )
      .slice(0, limit);

    for (const d of runnable) {
      d.status = "processing";
      d.attempts += 1;
      d.claimed_at = at(now);
    }

    return runnable.map((d) => ({ ...d }));
  }

  private find(id: string): EventDeliveryRow | undefined {
    return this.deliveries.find((d) => d.id === id);
  }

  async markDone(id: string): Promise<void> {
    const d = this.find(id);

    if (d) {
      d.status = "done";
      d.handled_at = at(this.now());
    }
  }

  async markFailed(
    id: string,
    error: string,
    backoffSeconds: number,
  ): Promise<void> {
    const d = this.find(id);

    if (d) {
      d.status = "failed";
      d.error = error;
      d.next_attempt_at = at(this.now() + backoffSeconds * 1000);
    }
  }

  async markDead(id: string, error: string): Promise<void> {
    const d = this.find(id);

    if (d) {
      d.status = "dead";
      d.error = error;
      d.handled_at = at(this.now());
    }
  }

  async reapStuck(): Promise<number> {
    const now = this.now();
    const stuck = this.deliveries.filter(
      (d) =>
        d.status === "processing" &&
        d.claimed_at !== null &&
        // <= not <: Postgres compares against a now() that has advanced since
        // the claim's statement, so a budget of N is due once N has elapsed. A
        // strict < here made a zero budget never due and the two disagree.
        Date.parse(d.claimed_at) + d.visibility_timeout_seconds * 1000 <= now,
    );

    for (const d of stuck) {
      d.status = "failed";
      d.next_attempt_at = at(now);
    }

    return stuck.length;
  }

  async pruneHandled(olderThanDays: number): Promise<number> {
    // Inclusive, unlike the strict `<` the SQL uses, because this clock does not
    // tick: with olderThanDays 0 the cutoff IS the handled_at just written, and a
    // strict compare would keep a row Postgres collects (its now() has moved on).
    const cutoff = this.now() - olderThanDays * 86_400_000;
    const before = this.deliveries.length;

    this.deliveries = this.deliveries.filter(
      (d) =>
        !(
          (d.status === "done" || d.status === "dead") &&
          d.handled_at !== null &&
          Date.parse(d.handled_at) <= cutoff
        ),
    );

    // An event is collectable only once nothing is still owed a delivery of it.
    const live = new Set(this.deliveries.map((d) => d.event_id));

    this.events = this.events.filter(
      (e) => live.has(e.id) || Date.parse(e.captured_at) > cutoff,
    );

    return before - this.deliveries.length;
  }

  async orphanedEvents(withinMinutes: number): Promise<OrphanedEvents[]> {
    const since = this.now() - withinMinutes * 60_000;
    const delivered = new Set(this.deliveries.map((d) => d.event_id));
    const counts = new Map<string, number>();

    for (const e of this.events) {
      if (delivered.has(e.id) || Date.parse(e.captured_at) < since) {
        continue;
      }
      counts.set(e.event_name, (counts.get(e.event_name) ?? 0) + 1);
    }

    return [...counts].map(([event_name, count]) => ({ event_name, count }));
  }
}
