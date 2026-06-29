/**
 * The drain loop (layer 2): claim a batch, dispatch each event to its registered
 * handler, transition the row. At-least-once — claim increments attempts up front,
 * so a crash-looping handler still walks to the dead-letter cutoff. Store ops are
 * injected so the dispatch logic is unit-testable without a database.
 */

import { decideRetry } from "./retry.js";
import { claimBatch, markDone, markFailed, markDead } from "./store.js";
import type { EventHandler, EventRow } from "../types.js";

export interface LoopDeps {
  resolve: (eventName: string) => EventHandler | undefined;
  claim: (limit: number) => Promise<EventRow[]>;
  markDone: (id: string) => Promise<void>;
  markFailed: (id: string, error: string, backoffSeconds: number) => Promise<void>;
  markDead: (id: string, error: string) => Promise<void>;
  batchSize?: number;
}

export async function handleOne(ev: EventRow, deps: LoopDeps): Promise<void> {
  const handler = deps.resolve(ev.event_name);
  if (!handler) {
    // Unknown name = config error, not transient → dead immediately.
    await deps.markDead(ev.id, `no handler for ${ev.event_name}`);
    return;
  }
  try {
    await handler(ev.params ?? {});
    await deps.markDone(ev.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const decision = decideRetry({ attempts: ev.attempts });
    if (decision.kind === "retry") await deps.markFailed(ev.id, message, decision.backoffSeconds);
    else await deps.markDead(ev.id, message);
  }
}

export async function drainOnce(deps: LoopDeps): Promise<number> {
  const batch = await deps.claim(deps.batchSize ?? 20);
  if (batch.length === 0) return 0;
  await Promise.allSettled(batch.map((ev) => handleOne(ev, deps)));
  return batch.length;
}

/** Wire the real store + start the 1s drain. Returns the timer for shutdown/tests. */
export function startEventLoop(
  resolve: (eventName: string) => EventHandler | undefined,
  intervalMs = 1000,
): NodeJS.Timeout {
  const deps: LoopDeps = { resolve, claim: claimBatch, markDone, markFailed, markDead };
  console.log("[events] drain loop started");
  return setInterval(() => {
    drainOnce(deps).catch((err) => console.error("[events] drain tick failed:", err));
  }, intervalMs);
}
