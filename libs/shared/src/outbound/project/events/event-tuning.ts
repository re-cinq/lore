/** The event-pipeline defaults every producer shares. They live here rather than in each composition root because a process that queues, retries or drains differently from the rest of the bus is a decision, and a decision should be visible as an override. */

/** Room for a router blip at the observed peak rate, not a durability budget — the queue is in memory and dies with the process. */
export const DEFAULT_QUEUE_CAPACITY = 256;

/** How hard a report tries before the Floor's reconcile cron is the only thing left to catch it. */
export const DEFAULT_REPORT_RETRY = { attempts: 5, delayMs: 500 } as const;

/** How long shutdown waits for the queue to drain — long enough for a backlog, short enough a wedged router cannot hold a rollout open. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;
