/** The drain loop (layer 2): claim a batch, dispatch each event to its registered handler, transition the row. At-least-once. */

import { decideRetry } from "./retry.js";
import type { EventDeliveryRow as EventRow } from "./event-deliveries-port.js";

/** Row identity a handler may need (e.g. to hand a large payload off by reference); handlers that don't care ignore it. */
export interface EventMeta {
  eventId: string;
}

/** A handler: self-sources its own deps; params carry the event payload. */
export type EventHandler = (
  params: Record<string, unknown>,
  meta?: EventMeta,
) => Promise<void>;

export type { EventRow };

export interface LoopDeps {
  resolve: (eventName: string) => EventHandler | undefined;
  claim: (limit: number, excludeEventNames: string[]) => Promise<EventRow[]>;
  markDone: (id: string) => Promise<void>;
  markFailed: (
    id: string,
    error: string,
    backoffSeconds: number,
  ) => Promise<void>;
  markDead: (id: string, error: string) => Promise<void>;
  batchSize?: number;
  /** Deadline before a serial handler's family slot is released (test hook). */
  serialDeadlineMs?: number;
  /** Serial-family override (test hook); defaults to the module set — empty since specs/ingest-station FR6. */
  serialFamilies?: ReadonlySet<string>;
}

/** A serial handler outliving this deadline releases its family slot before the reaper (600s) re-queues the row (observed 2026-07-16: one hung call froze spec_trace ingestion). */
const SERIAL_DEADLINE_MS = 620_000;

const releaseAfter = (ms: number): Promise<"deadline"> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve("deadline"), ms);

    timer.unref?.();
  });

/** Families whose handlers contend on shared external state, excluded at CLAIM time; EMPTY since specs/ingest-station FR6 (isolation now comes from one-pod-per-event). */
const SERIAL_FAMILIES: ReadonlySet<string> = new Set();

/** Serial families with a handler in flight, shared across drain ticks. */
const busyFamilies = new Set<string>();

/** Give up on a delivery, out loud — dead-lettering used to write the row and say nothing, and the row itself is deleted by the hourly prune a week later. */
async function deadLetter(
  deps: LoopDeps,
  ev: EventRow,
  reason: string,
): Promise<void> {
  console.error(
    `[events] dead-lettered ${ev.event_name} (delivery ${ev.id}, event ${ev.event_id}) after ${ev.attempts} attempt(s): ${reason}`,
  );
  await deps.markDead(ev.id, reason);
}

export async function handleOne(ev: EventRow, deps: LoopDeps): Promise<void> {
  const handler = deps.resolve(ev.event_name);

  if (!handler) {
    // Unknown name = config error, not transient — subscription set and registry have drifted apart.
    await deadLetter(deps, ev, `no handler for ${ev.event_name}`);

    return;
  }

  try {
    // event_id, NOT id: `id` addresses the DELIVERY; a handler citing an event needs the event itself.
    await handler(ev.params ?? {}, { eventId: ev.event_id });
    await deps.markDone(ev.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const decision = decideRetry({ attempts: ev.attempts });

    if (decision.kind === "retry") {
      await deps.markFailed(ev.id, message, decision.backoffSeconds);

      return;
    }
    await deadLetter(deps, ev, message);
  }
}

/** Buckets events by event_name, preserving arrival order within each family. */
function groupByFamily(events: EventRow[]): Map<string, EventRow[]> {
  const byFamily = new Map<string, EventRow[]>();

  for (const ev of events) {
    byFamily.set(ev.event_name, [...(byFamily.get(ev.event_name) ?? []), ev]);
  }

  return byFamily;
}

export async function drainOnce(deps: LoopDeps): Promise<number> {
  const serialFamilies = deps.serialFamilies ?? SERIAL_FAMILIES;
  const batch = await deps.claim(deps.batchSize ?? 20, [...busyFamilies]);

  if (batch.length === 0) {
    return 0;
  }

  // A rejection here means the mark-op itself failed (e.g. DB down mid-drain); surface it rather than letting it vanish.
  const logTransitionFailure = (ev: EventRow) => (reason: unknown) =>
    console.error(
      `[events] drain: transition failed for ${ev.event_name} (${ev.id}):`,
      reason,
    );

  const parallel = batch
    .filter((ev) => !serialFamilies.has(ev.event_name))
    .map((ev) => handleOne(ev, deps).catch(logTransitionFailure(ev)));

  const serialByFamily = groupByFamily(
    batch.filter((ev) => serialFamilies.has(ev.event_name)),
  );

  const deadlineMs = deps.serialDeadlineMs ?? SERIAL_DEADLINE_MS;
  const serial = [...serialByFamily.entries()].map(async ([family, events]) => {
    busyFamilies.add(family);

    try {
      for (const ev of events) {
        const outcome = await Promise.race([
          handleOne(ev, deps).catch(logTransitionFailure(ev)),
          releaseAfter(deadlineMs),
        ]);

        if (outcome === "deadline") {
          console.error(
            `[events] serial handler for ${ev.event_name} (${ev.id}) exceeded ${deadlineMs}ms — releasing the family slot to its reaped retry`,
          );
        }
      }
    } finally {
      busyFamilies.delete(family);
    }
  });

  await Promise.all([...parallel, ...serial]);

  return batch.length;
}

/** Wire the real store + start the 1s drain; STORE is passed in since both the Floor and the stations service drain their own deliveries. Returns the timer for shutdown/tests. */
export function startEventLoop(
  deps: LoopDeps,
  intervalMs = 1000,
): NodeJS.Timeout {
  console.log("[events] drain loop started");

  return setInterval(() => {
    drainOnce(deps).catch((err) =>
      console.error("[events] drain tick failed:", err),
    );
  }, intervalMs);
}
