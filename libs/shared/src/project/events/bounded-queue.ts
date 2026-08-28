/**
 * A fixed-capacity FIFO whose `push` BLOCKS instead of dropping.
 *
 * The bound is the whole point: an unbounded in-memory queue in front of an
 * unreachable router grows until the process dies, and a lossy one silently
 * discards exactly what nobody is left to re-derive. Blocking pushes the
 * pressure back to the producer, which is the only place that can decide to slow
 * down.
 *
 * Backpressure only bites if the producer AWAITS the push. A caller that fires
 * `void queue.push(x)` accumulates pending promises instead of items and the
 * bound becomes fiction — see the watch callback in the cluster-agent.
 *
 * No timers, no IO, nothing to fake: this is the decision half of the proxy, and
 * it is tested directly.
 */

import { enforceTrue } from "../../lib/enforce.js";

interface Waiter<T> {
  item: T;
  admit: () => void;
}

export class BoundedQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Waiter<T>[] = [];

  constructor(private readonly capacity: number) {
    enforceTrue(
      Number.isInteger(capacity) && capacity >= 1,
      Error,
      `BoundedQueue capacity must be at least 1, got ${capacity}`,
    );
  }

  /** Items currently held. Never exceeds the capacity. */
  get size(): number {
    return this.items.length;
  }

  /** Producers parked on a full queue. A steady non-zero value means the sink
   *  cannot keep up with what the inputs are producing. */
  get waiting(): number {
    return this.waiters.length;
  }

  /**
   * Accept an item, resolving once it is actually queued.
   *
   * Waiters are admitted in arrival order, so a blocked producer never
   * overtakes one that blocked before it — the drain stays FIFO end to end even
   * while it is saturated.
   */
  push(item: T): Promise<void> {
    if (this.items.length < this.capacity) {
      this.items.push(item);

      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiters.push({ item, admit: resolve });
    });
  }

  /** Take the head, admitting the longest-waiting producer into the slot it
   *  frees. */
  shift(): T | undefined {
    const head = this.items.shift();
    const waiter = this.waiters.shift();

    if (waiter) {
      this.items.push(waiter.item);
      waiter.admit();
    }

    return head;
  }
}
