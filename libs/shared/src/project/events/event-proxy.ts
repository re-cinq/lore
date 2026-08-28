/**
 * The hub every producer reports through: one bounded queue, one retry ladder,
 * one credential rotation.
 *
 * TWO PATHS, deliberately:
 *
 * - `insert` is synchronous and THROWS, so it is a drop-in `EventReporter`.
 *   Three Floor ingress routes and two lore-api routes answer 202 only after the
 *   insert lands and turn a throw into a 500 so the sender redelivers; queueing
 *   underneath them would convert at-least-once GitHub/CI delivery into
 *   best-effort, and the queue is lost on every rollout.
 * - `emit` queues, and blocks the producer when the queue is full. It is for
 *   producers with nobody to return a status to — a Kubernetes watch callback, a
 *   sweep that today writes `.catch(() => {})` — where the choice was previously
 *   between an inline retry ladder and silent loss.
 *
 * Delivery is SERIAL: the router takes one event per POST and has no batch
 * endpoint, so a parallel drain would only race the ordering away.
 *
 * The queue lives in memory and dies with the process. That is survivable only
 * because everything on it is deduped and re-derivable — terminal Agent events
 * carry a dedupe key and the Floor's reconcile cron re-emits what is missed. It
 * is not a durable outbox, and `stop` must be awaited on shutdown or the
 * backlog goes with the pod.
 */

import { enforceTrue } from "../../lib/enforce.js";
import type { EventInsert } from "../../events.js";
import { BoundedQueue } from "./bounded-queue.js";
import { nextDeliveryStep } from "./delivery-policy.js";
import type { EventReporter } from "./event-queue-port.js";
import type { EventInput, ProxyMessage, Sink } from "./event-input-port.js";

export interface EventProxyDeps {
  sinks: Record<ProxyMessage["kind"], Sink>;
  /** How many messages may wait before producers block. */
  capacity: number;
  retry: { attempts: number; delayMs: number };
  /**
   * Rotate the credential when a sink refuses it. A satellite passes its
   * single-flight re-registration; a central process has nothing to rotate and
   * leaves this unset.
   */
  onUnauthorized?: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

/** What a dropped message is called in the log — the only trace it leaves. */
function describe(message: ProxyMessage): string {
  return message.kind === "event"
    ? `event ${message.event.eventName}`
    : `telemetry (${message.body.length} bytes)`;
}

export class EventProxy implements EventReporter {
  private readonly queue: BoundedQueue<ProxyMessage>;
  private readonly inputs: EventInput[] = [];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private running = false;
  private loop: Promise<void> | null = null;
  /** Resolves the drain loop's idle wait as soon as something is queued. */
  private wake: (() => void) | null = null;

  constructor(private readonly deps: EventProxyDeps) {
    enforceTrue(
      deps.retry.attempts >= 1,
      Error,
      `EventProxy needs at least one delivery attempt, got ${deps.retry.attempts}`,
    );
    this.queue = new BoundedQueue<ProxyMessage>(deps.capacity);
    this.sleep =
      deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? console.error;
  }

  /** Messages waiting to be delivered. A steady non-zero value means the sink
   *  is not keeping up with the inputs. */
  get depth(): number {
    return this.queue.size;
  }

  /**
   * Report an event and wait for it to land. Throws what the sink throws — the
   * contract the 500-returning ingress routes are built on.
   */
  insert(event: EventInsert): Promise<void> {
    return this.deps.sinks.event.deliver({ kind: "event", event });
  }

  /** Queue a message, blocking while the queue is full. */
  async emit(message: ProxyMessage): Promise<void> {
    await this.queue.push(message);
    this.signal();
  }

  register(input: EventInput): void {
    this.inputs.push(input);
  }

  /** Begin draining, then start every registered input.
   *
   *  The drain starts FIRST on purpose: an input whose `start` emits more than
   *  the capacity would otherwise block forever on a queue nobody is reading. */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loop = this.drainForever();

    for (const input of this.inputs) {
      await input.start((message) => this.emit(message));
    }
  }

  /**
   * Stop the inputs and drain what is left, giving up after `timeoutMs`.
   *
   * Returns the number of messages it could not deliver, so the caller's
   * shutdown log can name what the rollout dropped instead of implying a clean
   * exit.
   */
  async stop(timeoutMs: number): Promise<number> {
    this.running = false;
    this.signal();

    for (const input of this.inputs) {
      await input.stop();
    }

    const deadline = this.now() + timeoutMs;

    if (this.loop) {
      await this.untilDeadline(this.loop, timeoutMs);
      this.loop = null;
    }

    while (this.queue.size > 0 && this.now() < deadline) {
      const message = this.queue.shift();

      if (!message) {
        break;
      }
      await this.untilDeadline(this.deliver(message), timeoutMs);
    }

    return this.queue.size;
  }

  private signal(): void {
    const wake = this.wake;

    this.wake = null;
    wake?.();
  }

  private async drainForever(): Promise<void> {
    while (this.running) {
      const message = this.queue.shift();

      if (message) {
        await this.deliver(message);
        continue;
      }
      // Set synchronously after the empty shift, in the same tick — nothing can
      // queue an item between the two and be missed.
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  /** One message, through the whole ladder. Never throws: the queued path has
   *  nobody to return a failure to. */
  private async deliver(message: ProxyMessage): Promise<void> {
    const { attempts, delayMs } = this.deps.retry;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.deps.sinks[message.kind].deliver(message);

        return;
      } catch (err) {
        const step = nextDeliveryStep({
          error: err,
          attempt,
          attempts,
          delayMs,
        });

        if (step.reauth) {
          await this.deps.onUnauthorized?.();
        }

        if (step.next.kind === "drop") {
          this.log(
            `[events] dropped ${describe(message)} after ${attempts} attempts: ${(err as Error).message}`,
          );

          return;
        }
        await this.sleep(step.next.delayMs);
      }
    }
  }

  /** Race `work` against a real timer, so a wedged sink cannot hold a rollout
   *  open. Deliberately not the injected `sleep`, which tests make instant. */
  private untilDeadline(
    work: Promise<unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout>;

    return Promise.race([
      work.finally(() => clearTimeout(timer)),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  }
}

/**
 * View a proxy as an `EventReporter` whose `insert` QUEUES.
 *
 * For the ports that are typed on `EventReporter` and cannot take a proxy —
 * `reportToParkedNode` is the one that matters — where the caller has nobody to
 * return a failure to. `pr-ready-check` catches per run and then resolves, so
 * its delivery is marked done whether or not the report landed: a blip lost the
 * resume outright, and the parked node waited for the reaper.
 *
 * A function rather than a class: it forwards one call and a class that only
 * forwards is rejected by `lore/no-forwarding-class`, correctly.
 */
export function queuedReporter(proxy: EventProxy): EventReporter {
  return { insert: (event) => proxy.emit({ kind: "event", event }) };
}
