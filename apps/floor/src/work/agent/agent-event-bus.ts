// The live fan-out for agent run events (#876/#877): IN-PROCESS ONLY, sound only because floor-helm PINS replicaCount: 1 — going multi-replica swaps this for PG LISTEN/NOTIFY behind the same subscribe/publish API (no synchronous handler returns, no shared mutable rows). DROP POLICY (FR5.4): an overflowing subscriber is dropped and told so (not silently thinned) — safe because the client's EventSource reconnects via Last-Event-ID and listSince replays the gap from the database, so a slow reader loses latency, never data.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AgentRunEventRow } from "@re-cinq/lore-shared";

export type AgentEventHandler = (rows: AgentRunEventRow[]) => void;

// Told to a subscriber the bus has just dropped, so an SSE transport can close the connection and let the client reconnect from its Last-Event-ID.
export type AgentEventOverflowHandler = () => void;

// Defensive cap: one assembly line's run page should need a handful of watchers, not hundreds of leaked subscriptions.
export const MAX_SUBSCRIBERS_PER_RUN = 20;

/** Undelivered events one subscriber may hold before the bus drops it (FR5.4). */
export const MAX_BUFFERED_EVENTS = 1000;

interface Subscriber {
  handler: AgentEventHandler;
  onOverflow: AgentEventOverflowHandler;
  buffer: AgentRunEventRow[][];
  buffered: number;
  draining: boolean;
}

function groupByRun(
  rows: readonly AgentRunEventRow[],
): Map<string, AgentRunEventRow[]> {
  const byRun = new Map<string, AgentRunEventRow[]>();

  for (const row of rows) {
    if (row.assemblyLineId === null) {
      continue;
    }
    const existing = byRun.get(row.assemblyLineId);

    if (existing) {
      existing.push(row);
      continue;
    }
    byRun.set(row.assemblyLineId, [row]);
  }

  return byRun;
}

export class AgentEventBus {
  private readonly runs = new Map<string, Set<Subscriber>>();

  // Watch one assembly line's events. Returns the unsubscribe; calling it more than once is a no-op.
  subscribe(
    assemblyRunId: string,
    handler: AgentEventHandler,
    onOverflow: AgentEventOverflowHandler = () => {},
  ): () => void {
    const subscribers = this.runs.get(assemblyRunId) ?? new Set<Subscriber>();

    enforceTrue(
      subscribers.size < MAX_SUBSCRIBERS_PER_RUN,
      Error,
      `agent event bus: ${assemblyRunId} already has ${MAX_SUBSCRIBERS_PER_RUN} subscribers`,
    );
    const subscriber: Subscriber = {
      handler,
      onOverflow,
      buffer: [],
      buffered: 0,
      draining: false,
    };

    subscribers.add(subscriber);
    this.runs.set(assemblyRunId, subscribers);

    return () => this.remove(assemblyRunId, subscribers, subscriber);
  }

  private remove(
    assemblyRunId: string,
    subscribers: Set<Subscriber>,
    subscriber: Subscriber,
  ): void {
    subscribers.delete(subscriber);

    // Identity check, not just emptiness: an unsubscribe closure's Set may already have been evicted and replaced — deleting on size alone would silently and permanently drop the CURRENT subscribers of the line.
    if (
      subscribers.size === 0 &&
      this.runs.get(assemblyRunId) === subscribers
    ) {
      this.runs.delete(assemblyRunId);
    }
  }

  // Fan out persisted rows. Rows that correlate to no assembly line are ignored — they are still durable, they simply have no per-line stream to feed.
  publish(rows: readonly AgentRunEventRow[]): void {
    for (const [assemblyRunId, batch] of groupByRun(rows)) {
      const subscribers = this.runs.get(assemblyRunId);

      if (!subscribers) {
        continue;
      }

      [...subscribers].forEach((subscriber) =>
        this.enqueue(assemblyRunId, subscribers, subscriber, batch),
      );
    }
  }

  private enqueue(
    assemblyRunId: string,
    subscribers: Set<Subscriber>,
    subscriber: Subscriber,
    batch: AgentRunEventRow[],
  ): void {
    subscriber.buffer.push(batch);
    subscriber.buffered += batch.length;

    if (subscriber.buffered > MAX_BUFFERED_EVENTS) {
      this.evictOverflowed(assemblyRunId, subscribers, subscriber);

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

  private evictOverflowed(
    assemblyRunId: string,
    subscribers: Set<Subscriber>,
    subscriber: Subscriber,
  ): void {
    this.remove(assemblyRunId, subscribers, subscriber);
    subscriber.buffer = [];
    subscriber.buffered = 0;
    this.safely(subscriber.onOverflow);
  }

  // A subscriber's own failure is its own; it must never stop the bus mid-fan-out or propagate back into the ingest request that published.
  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // Deliberately swallowed: see above.
    }
  }

  // A handler that publishes re-enters publish while this drain is running; the buffer makes that iterative instead of recursive, and one throwing handler can never stop the others' delivery.
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

// The process-wide bus. Module-level rather than in kernel/queues.ts: it needs no database pool, and queues.ts is the composition root for Pg adapters.
export const agentEventBus = (): AgentEventBus =>
  (busSingleton ??= new AgentEventBus());
