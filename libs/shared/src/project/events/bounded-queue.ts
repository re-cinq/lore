// Fixed-capacity FIFO whose `push` BLOCKS instead of dropping, pushing backpressure to the producer; only works if the caller AWAITS push (`void queue.push(x)` makes the bound fiction).

import { enforceTrue } from "../../lib/enforce.js";

interface Waiter<T> {
  entry: T;
  admit: () => void;
}

export class BoundedQueue<T> {
  private readonly entries: T[] = [];
  private readonly waiters: Waiter<T>[] = [];

  constructor(private readonly capacity: number) {
    enforceTrue(
      Number.isInteger(capacity) && capacity >= 1,
      Error,
      `BoundedQueue capacity must be at least 1, got ${capacity}`,
    );
  }

  /** Entries currently held. Never exceeds the capacity. */
  get size(): number {
    return this.entries.length;
  }

  /** Producers parked on a full queue; a steady non-zero value means the sink can't keep up. */
  get waiting(): number {
    return this.waiters.length;
  }

  /** Accept an entry, resolving once queued; waiters are admitted in arrival order so the drain stays FIFO even while saturated. */
  push(entry: T): Promise<void> {
    if (this.entries.length < this.capacity) {
      this.entries.push(entry);

      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiters.push({ entry, admit: resolve });
    });
  }

  /** Take the head, admitting the longest-waiting producer into the slot it frees. */
  shift(): T | undefined {
    const head = this.entries.shift();
    const waiter = this.waiters.shift();

    if (waiter) {
      this.entries.push(waiter.entry);
      waiter.admit();
    }

    return head;
  }
}
