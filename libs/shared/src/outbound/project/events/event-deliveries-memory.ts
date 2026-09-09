import { eventRepo, type EventInsert } from "../../events.js";
import type {
  EventDeliveriesPort,
  EventDeliveryRow,
  EventSubscription,
  OrphanedEvents,
  DeadLetteredDeliveries,
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

/** The untouched half of every freshly fanned-out delivery. */
const UNATTEMPTED = {
  status: "pending",
  attempts: 0,
  error: null,
  claimed_at: null,
  handled_at: null,
} as const;

/** A pending delivery of one event to one subscriber, due immediately at capture time. */
function newDelivery(
  id: string,
  event: StoredEvent,
  subscriber: string,
  visibilityTimeoutSeconds: number,
): EventDeliveryRow {
  return {
    ...UNATTEMPTED,
    id,
    subscriber,
    event_id: event.id,
    event_name: event.event_name,
    source: event.source,
    params: event.params,
    repo: event.repo,
    next_attempt_at: event.captured_at,
    visibility_timeout_seconds: visibilityTimeoutSeconds,
  };
}

/** The store's claim order: earliest due first, ties broken by insertion id. */
function byDueThenId(a: EventDeliveryRow, b: EventDeliveryRow): number {
  if (a.next_attempt_at === b.next_attempt_at) {
    return Number(a.id) - Number(b.id);
  }

  return a.next_attempt_at < b.next_attempt_at ? -1 : 1;
}

/** Claim window: one subscriber's due, unheld, unfinished deliveries. */
interface ClaimWindow {
  subscriber: string;
  now: number;
  held: Set<string>;
  limit: number;
}

function isRunnable(d: EventDeliveryRow, window: ClaimWindow): boolean {
  return (
    d.subscriber === window.subscriber &&
    !window.held.has(d.event_name) &&
    (d.status === "pending" || d.status === "failed") &&
    Date.parse(d.next_attempt_at) <= window.now
  );
}

/** Due deliveries for one subscriber in claim order, capped at the limit. */
function runnableDeliveries(
  deliveries: readonly EventDeliveryRow[],
  window: ClaimWindow,
): EventDeliveryRow[] {
  return deliveries
    .filter((d) => isRunnable(d, window))
    .sort(byDueThenId)
    .slice(0, window.limit);
}

/** Deliveries permanently given up on since `since`; a dead row always carries handled_at, so a missing one simply falls outside the window. */
function deadSince(
  deliveries: readonly EventDeliveryRow[],
  since: number,
): EventDeliveryRow[] {
  return deliveries.filter(
    (d) => d.status === "dead" && Date.parse(d.handled_at ?? "") >= since,
  );
}

/** In-memory EventDeliveriesPort — behavioural spec of the Pg adapter over two arrays; now is injectable for deterministic backoff/visibility windows. Fan-out happens inside insert, same as the SQL clause. */
export class InMemoryEventDeliveries implements EventDeliveriesPort {
  private eventSeq = 0;
  private deliverySeq = 0;

  constructor(
    public readonly events: StoredEvent[] = [],
    public readonly deliveries: EventDeliveryRow[] = [],
    public readonly subscriptions: Map<string, Map<string, number>> = new Map(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async subscribe(
    subscriber: string,
    subscriptions: EventSubscription[],
  ): Promise<void> {
    // Replaces rather than merges — a boot registration declares the whole set, so an omitted name was removed; an empty set says nothing, so a mis-booted subscriber isn't taken off the bus.
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

  /** One delivery per subscriber, skipping existing ones; shared by insert and boot reconcile so they can't disagree — mirrors the store's (event_id, subscriber) uniqueness. */
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
      this.deliveries.push(
        newDelivery(String(++this.deliverySeq), event, subscriber, timeout),
      );
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
    const runnable = runnableDeliveries(this.deliveries, {
      subscriber,
      now,
      held: new Set(excludeEventNames),
      limit,
    });

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
        // <= not <: Postgres compares against an advanced now(), so a budget of N is due once N has elapsed; strict < made a zero budget never due.
        Date.parse(d.claimed_at) + d.visibility_timeout_seconds * 1000 <= now,
    );

    for (const d of stuck) {
      d.status = "failed";
      d.next_attempt_at = at(now);
    }

    return stuck.length;
  }

  async pruneHandled(olderThanDays: number): Promise<number> {
    // Inclusive (unlike the SQL's strict <) since this clock doesn't tick — with olderThanDays 0 the cutoff equals the just-written handled_at.
    const cutoff = this.now() - olderThanDays * 86_400_000;
    const before = this.deliveries.length;

    const keptDeliveries = this.deliveries.filter(
      (d) =>
        !(
          (d.status === "done" || d.status === "dead") &&
          d.handled_at !== null &&
          Date.parse(d.handled_at) <= cutoff
        ),
    );

    this.deliveries.splice(0, this.deliveries.length, ...keptDeliveries);

    // An event is collectable only once nothing is still owed a delivery of it.
    const live = new Set(this.deliveries.map((d) => d.event_id));

    const keptEvents = this.events.filter(
      (e) => live.has(e.id) || Date.parse(e.captured_at) > cutoff,
    );

    this.events.splice(0, this.events.length, ...keptEvents);

    return before - this.deliveries.length;
  }

  async deadLettered(withinMinutes: number): Promise<DeadLetteredDeliveries[]> {
    const since = this.now() - withinMinutes * 60_000;
    const grouped = new Map<string, DeadLetteredDeliveries>();

    for (const d of deadSince(this.deliveries, since)) {
      const key = `${d.event_name} ${d.subscriber}`;
      const seen = grouped.get(key);

      grouped.set(key, {
        event_name: d.event_name,
        subscriber: d.subscriber,
        count: (seen?.count ?? 0) + 1,
        last_error: d.error,
      });
    }

    return [...grouped.values()];
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
