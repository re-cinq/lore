// Hub every producer reports through (bounded queue, retry ladder, credential rotation). insert() is sync+throws (drop-in EventReporter, preserves at-least-once ingress semantics); emit() queues+blocks when full (for producers with no one to report to). Delivery is serial (no batch endpoint); queue is in-memory and not durable — everything on it is deduped/re-derivable, and stop() must be awaited on shutdown or the backlog is lost.

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
  /** Rotate the credential when a sink refuses it (satellite passes its re-registration; central leaves unset). */
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

  /** Messages waiting to be delivered; a steady non-zero value means the sink isn't keeping up. */
  get depth(): number {
    return this.queue.size;
  }

  /** Reports an event and waits for it to land; throws what the sink throws (the contract 500-returning ingress routes rely on). */
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

  /** Begins draining, then starts every registered input — drain starts first, or an input emitting past capacity blocks forever on nobody reading. */
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

  /** Stops inputs, drains what's left (giving up after timeoutMs); returns undelivered count so shutdown logs can name what the rollout dropped. */
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
      // Set synchronously after the empty shift, same tick — nothing can queue between the two and be missed.
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  /** One message through the whole ladder; never throws — the queued path has nobody to return a failure to. */
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

  /** Races work against a real timer (not the injected sleep, which tests make instant) so a wedged sink can't hold a rollout open. */
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

/** Views a proxy as an EventReporter whose insert queues, for ports typed on EventReporter with no one to report failure to (reportToParkedNode); a function since a forwarding-only class is rejected by lore/no-forwarding-class. */
export function queuedReporter(proxy: EventProxy): EventReporter {
  return { insert: (event) => proxy.emit({ kind: "event", event }) };
}
