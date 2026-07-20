// The live fan-out side of agent run events (#876): the ingest route publishes
// the rows it just persisted, and #877's SSE endpoint subscribes per assembly
// line.
//
// IN-PROCESS ONLY, AND ONLY SOUND BECAUSE floor-helm PINS replicaCount: 1. A
// second replica would serve SSE clients that never see events published on the
// other pod. Going multi-replica means swapping these internals for PG
// LISTEN/NOTIFY behind this exact subscribe/publish API — which is why the API
// carries no in-process assumptions: no synchronous return values from handlers,
// no shared mutable rows, no ordering guarantee beyond per-line arrival order.
//
// DROP POLICY (FR5.4). Each subscriber may hold at most MAX_BUFFERED_EVENTS
// undelivered events; on overflow the SUBSCRIBER is dropped and told so, rather
// than the events being silently thinned. Dropping is safe precisely because it
// is recoverable: the client's EventSource reconnects with its Last-Event-ID and
// listSince replays the gap from the database, so a slow reader loses latency,
// never data. The durable row is always the source of truth and the bus is only
// ever an accelerator — which is what lets a stalled client be cut loose instead
// of being allowed to grow the Floor's heap or apply back-pressure to ingest.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AgentRunEventRow } from "@re-cinq/lore-shared";

export type AgentEventHandler = (rows: AgentRunEventRow[]) => void;

/** Told to a subscriber the bus has just dropped, so an SSE transport can close
 *  the connection and let the client reconnect from its Last-Event-ID. */
export type AgentEventOverflowHandler = () => void;

/** Defensive cap: one assembly line's run page should need a handful of
 *  watchers, not hundreds of leaked subscriptions. */
export const MAX_SUBSCRIBERS_PER_LINE = 20;

/** Undelivered events one subscriber may hold before the bus drops it (FR5.4). */
export const MAX_BUFFERED_EVENTS = 1000;

interface Subscriber {
  handler: AgentEventHandler;
  onOverflow: AgentEventOverflowHandler;
  buffer: AgentRunEventRow[][];
  buffered: number;
  draining: boolean;
}

function groupByLine(
  rows: readonly AgentRunEventRow[],
): Map<string, AgentRunEventRow[]> {
  const byLine = new Map<string, AgentRunEventRow[]>();

  for (const row of rows) {
    if (row.assemblyLineId === null) {
      continue;
    }
    const existing = byLine.get(row.assemblyLineId);

    if (existing) {
      existing.push(row);
    } else {
      byLine.set(row.assemblyLineId, [row]);
    }
  }

  return byLine;
}

export class AgentEventBus {
  private readonly lines = new Map<string, Set<Subscriber>>();

  /** Watch one assembly line's events. Returns the unsubscribe; calling it more
   *  than once is a no-op. */
  subscribe(
    assemblyLineId: string,
    handler: AgentEventHandler,
    onOverflow: AgentEventOverflowHandler = () => {},
  ): () => void {
    const subscribers = this.lines.get(assemblyLineId) ?? new Set<Subscriber>();

    enforceTrue(
      subscribers.size < MAX_SUBSCRIBERS_PER_LINE,
      Error,
      `agent event bus: ${assemblyLineId} already has ${MAX_SUBSCRIBERS_PER_LINE} subscribers`,
    );
    const subscriber: Subscriber = {
      handler,
      onOverflow,
      buffer: [],
      buffered: 0,
      draining: false,
    };

    subscribers.add(subscriber);
    this.lines.set(assemblyLineId, subscribers);

    return () => this.remove(assemblyLineId, subscribers, subscriber);
  }

  private remove(
    assemblyLineId: string,
    subscribers: Set<Subscriber>,
    subscriber: Subscriber,
  ): void {
    subscribers.delete(subscriber);

    if (subscribers.size === 0) {
      this.lines.delete(assemblyLineId);
    }
  }

  /** Fan out persisted rows. Rows that correlate to no assembly line are ignored
   *  — they are still durable, they simply have no per-line stream to feed. */
  publish(rows: readonly AgentRunEventRow[]): void {
    for (const [assemblyLineId, batch] of groupByLine(rows)) {
      const subscribers = this.lines.get(assemblyLineId);

      if (!subscribers) {
        continue;
      }

      for (const subscriber of [...subscribers]) {
        this.enqueue(assemblyLineId, subscribers, subscriber, batch);
      }
    }
  }

  private enqueue(
    assemblyLineId: string,
    subscribers: Set<Subscriber>,
    subscriber: Subscriber,
    batch: AgentRunEventRow[],
  ): void {
    subscriber.buffer.push(batch);
    subscriber.buffered += batch.length;

    if (subscriber.buffered > MAX_BUFFERED_EVENTS) {
      this.remove(assemblyLineId, subscribers, subscriber);
      subscriber.buffer = [];
      subscriber.buffered = 0;
      this.safely(subscriber.onOverflow);

      return;
    }

    if (subscriber.draining) {
      return;
    }
    subscriber.draining = true;

    try {
      this.drain(subscriber);
    } finally {
      subscriber.draining = false;
    }
  }

  // A subscriber's own failure is its own; it must never stop the bus mid-fan-out
  // or propagate back into the ingest request that published.
  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // Deliberately swallowed: see above.
    }
  }

  // A handler that publishes (directly or via a callback) re-enters publish
  // while this drain is running; the buffer makes that iterative instead of
  // recursive, and one throwing handler can never stop the others' delivery.
  private drain(subscriber: Subscriber): void {
    let next = subscriber.buffer.shift();

    while (next) {
      subscriber.buffered -= next.length;
      const batch = next;

      this.safely(() => subscriber.handler(batch));
      next = subscriber.buffer.shift();
    }
  }
}

let busSingleton: AgentEventBus | undefined;

/** The process-wide bus. Module-level rather than in kernel/queues.ts: it needs
 *  no database pool, and queues.ts is the composition root for Pg adapters. */
export const agentEventBus = (): AgentEventBus =>
  (busSingleton ??= new AgentEventBus());
