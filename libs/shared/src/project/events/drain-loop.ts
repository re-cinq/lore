/**
 * The drain loop (layer 2): claim a batch, dispatch each event to its registered
 * handler, transition the row. At-least-once — claim increments attempts up front,
 * so a crash-looping handler still walks to the dead-letter cutoff. Store ops are
 * injected so the dispatch logic is unit-testable without a database.
 */

import { decideRetry } from "./retry.js";
import type { EventDeliveryRow as EventRow } from "./event-deliveries-port.js";

/** Row identity a handler may need (e.g. to hand a large payload off by
 *  reference instead of copying it); handlers that don't care ignore it. */
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
  /** Serial-family override (test hook); defaults to the module set — empty
   *  since specs/ingest-station FR6. */
  serialFamilies?: ReadonlySet<string>;
}

/**
 * A serial handler that outlives this deadline releases its family slot: by
 * then the reaper (600s) has already re-queued the row, and holding the busy
 * flag for an unsettled promise starves every later event in the family
 * (observed 2026-07-16: one hung network call froze spec_trace ingestion for
 * good). The abandoned handler runs on unsupervised — exactly a parallel
 * handler's failure mode — and its writes stay safe (idempotent upserts).
 */
const SERIAL_DEADLINE_MS = 620_000;

const releaseAfter = (ms: number): Promise<"deadline"> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve("deadline"), ms);

    timer.unref?.();
  });

/**
 * Families whose handlers contend on shared external state: at most one
 * handler in flight per Floor instance, excluded at CLAIM time so waiting rows
 * stay `pending` (a dispatch-side queue would park claimed rows in
 * `processing`, where the >600s reaper re-runs them concurrently). EMPTY since
 * specs/ingest-station FR6 — no in-process dgraph writer remains; chunk
 * isolation now comes from one-pod-per-event, the station deadline, and dgraph
 * retry-on-abort inside the pod. The mechanism stays as a general tool
 * (LoopDeps.serialFamilies is the seam).
 */
const SERIAL_FAMILIES: ReadonlySet<string> = new Set();

/** Serial families with a handler in flight, shared across drain ticks. */
const busyFamilies = new Set<string>();

/**
 * Give up on a delivery, out loud.
 *
 * Dead-lettering used to write the row and say nothing, so work the bus had
 * abandoned left no trace anywhere an operator looks — the row itself is deleted
 * by the hourly prune a week later. Every failure mode this platform has actually
 * suffered was silent; this one costs a log line to stop being.
 */
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
    // Unknown name = config error, not transient → dead immediately.
    //
    // Since the Floor consumes DELIVERIES it only receives what it subscribed
    // to, so reaching here means the subscription set and the registry have
    // drifted apart — which they are derived from each other to prevent.
    await deadLetter(deps, ev, `no handler for ${ev.event_name}`);

    return;
  }

  try {
    // event_id, NOT id: `id` addresses the DELIVERY (what ack/fail/dead take),
    // while a handler citing an event — the ingest station fetches a large
    // payload by reference as `payload_event_id` — needs the event itself.
    await handler(ev.params ?? {}, { eventId: ev.event_id });
    await deps.markDone(ev.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const decision = decideRetry({ attempts: ev.attempts });

    if (decision.kind === "retry") {
      await deps.markFailed(ev.id, message, decision.backoffSeconds);
    } else {
      await deadLetter(deps, ev, message);
    }
  }
}

export async function drainOnce(deps: LoopDeps): Promise<number> {
  const serialFamilies = deps.serialFamilies ?? SERIAL_FAMILIES;
  const batch = await deps.claim(deps.batchSize ?? 20, [...busyFamilies]);

  if (batch.length === 0) {
    return 0;
  }

  // handleOne swallows handler errors into the row's state; a rejection here means a
  // mark-op itself failed (e.g. DB down mid-drain) and the row is left mid-flight for
  // the reaper — surface it rather than letting it vanish.
  const logTransitionFailure = (ev: EventRow) => (reason: unknown) =>
    console.error(
      `[events] drain: transition failed for ${ev.event_name} (${ev.id}):`,
      reason,
    );

  const parallel = batch
    .filter((ev) => !serialFamilies.has(ev.event_name))
    .map((ev) => handleOne(ev, deps).catch(logTransitionFailure(ev)));

  const serialByFamily = new Map<string, EventRow[]>();

  for (const ev of batch.filter((e) => serialFamilies.has(e.event_name))) {
    serialByFamily.set(ev.event_name, [
      ...(serialByFamily.get(ev.event_name) ?? []),
      ev,
    ]);
  }

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

/** Wire the real store + start the 1s drain. Returns the timer for shutdown/tests. */
/**
 * Start draining. The STORE is passed in, not imported: two processes drain now
 * — the Floor its own deliveries, the stations service its own — and a loop that
 * reached for one of them could only ever serve that one.
 */
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
