// Postgres LISTEN/NOTIFY as the run stream's fan-out (ADR-037 amendment 2026-09): the triggers in migration 0070 say WHAT changed (ids only), the session re-reads the row. One dedicated client per process, outside the pool, so held stream connections never cost pool capacity; a lost connection reconnects with backoff and tells every subscriber to resync, because notifications during the gap are gone by design.

import pg from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

export const NOTIFY_CHANNEL = "lore_run_stream";

/** Defensive cap: one run's page should need a handful of watchers, not hundreds of leaked subscriptions. */
export const MAX_SUBSCRIBERS_PER_RUN = 20;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 30_000;

export type NotificationKind =
  "agent_event" | "node_status" | "run_status" | "task_event" | "ci_check";

const KINDS: ReadonlySet<string> = new Set<NotificationKind>([
  "agent_event",
  "node_status",
  "run_status",
  "task_event",
  "ci_check",
]);

/** What a trigger said: the kind and the ids that name the changed row. */
export interface RunNotification {
  kind: NotificationKind;
  run?: string;
  row?: string;
  task?: string;
  id?: string;
  repo?: string;
  pr?: string;
}

/** The identities one stream session cares about. */
export interface NotifyFilter {
  runId: string;
  taskId: string | null;
  repo: string;
  prNumber: number | null;
}

export type NotificationHandler = (notification: RunNotification) => void;

export interface RunNotifier {
  /** Subscribe to the changes `filter` names; `onResync` fires after a reconnect, when notifications may have been missed. Returns the unsubscribe. Throws past {@link MAX_SUBSCRIBERS_PER_RUN}. */
  subscribe(
    filter: NotifyFilter,
    handler: NotificationHandler,
    onResync?: () => void,
  ): () => void;
}

const optionalString = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : String(value);

/** A trigger payload as a notification, or null for anything that is not one — a foreign channel or a malformed body must not take the hub down. */
export function parseNotification(payload: string): RunNotification | null {
  try {
    const body = JSON.parse(payload) as Record<string, unknown>;

    if (typeof body.kind !== "string" || !KINDS.has(body.kind)) {
      return null;
    }

    return {
      kind: body.kind as NotificationKind,
      run: optionalString(body.run),
      row: optionalString(body.row),
      task: optionalString(body.task),
      id: optionalString(body.id),
      repo: optionalString(body.repo),
      pr: optionalString(body.pr),
    };
  } catch {
    return null;
  }
}

/** Run-keyed kinds match on the run; a task event on the task; a check on repo + PR. */
export function matchesFilter(
  notification: RunNotification,
  filter: NotifyFilter,
): boolean {
  switch (notification.kind) {
    case "task_event":
      return filter.taskId !== null && notification.task === filter.taskId;
    case "ci_check":
      return (
        filter.prNumber !== null &&
        notification.repo === filter.repo &&
        notification.pr === String(filter.prNumber)
      );
    default:
      return notification.run === filter.runId;
  }
}

interface Subscriber {
  filter: NotifyFilter;
  handler: NotificationHandler;
  onResync: () => void;
}

/** The subscriber registry both notifiers share: cap per run, dispatch by filter, resync broadcast. */
class SubscriberSet {
  private readonly subscribers = new Set<Subscriber>();

  add(subscriber: Subscriber): () => void {
    const onRun = [...this.subscribers].filter(
      (s) => s.filter.runId === subscriber.filter.runId,
    ).length;

    enforceTrue(
      onRun < MAX_SUBSCRIBERS_PER_RUN,
      Error,
      `run stream: ${subscriber.filter.runId} already has ${MAX_SUBSCRIBERS_PER_RUN} subscribers`,
    );
    this.subscribers.add(subscriber);

    return () => this.subscribers.delete(subscriber);
  }

  get size(): number {
    return this.subscribers.size;
  }

  dispatch(notification: RunNotification): void {
    for (const subscriber of this.subscribers) {
      if (matchesFilter(notification, subscriber.filter)) {
        safely(() => subscriber.handler(notification));
      }
    }
  }

  resyncAll(): void {
    for (const subscriber of this.subscribers) {
      safely(subscriber.onResync);
    }
  }
}

// A subscriber's own failure is its own; it must never stop the hub mid-dispatch.
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Deliberately swallowed: see above.
  }
}

/** The test double: `publish` stands in for a trigger, `resync` for a reconnect. */
export class InMemoryRunNotifier implements RunNotifier {
  private readonly set = new SubscriberSet();

  subscribe(
    filter: NotifyFilter,
    handler: NotificationHandler,
    onResync: () => void = () => {},
  ): () => void {
    return this.set.add({ filter, handler, onResync });
  }

  publish(notification: RunNotification): void {
    this.set.dispatch(notification);
  }

  resync(): void {
    this.set.resyncAll();
  }

  get subscriberCount(): number {
    return this.set.size;
  }
}

/** The pieces of a `pg.Client` the hub touches, so a test can hand in a fake. */
export interface ListenClient {
  connect(): Promise<void>;
  query(text: string): Promise<unknown>;
  on(
    event: "notification",
    listener: (msg: { payload?: string }) => void,
  ): void;
  on(event: "error" | "end", listener: (err?: unknown) => void): void;
  end(): Promise<void>;
}

export interface PgRunNotifierOptions {
  connect: () => ListenClient;
  /** Injected for tests; production uses setTimeout. */
  schedule?: (fn: () => void, delayMs: number) => void;
  log?: (message: string) => void;
}

type HubState = "idle" | "connecting" | "listening";

/** The production notifier: lazily opens the LISTEN connection on the first subscriber and holds it for the process's life. */
export class PgRunNotifier implements RunNotifier {
  private readonly set = new SubscriberSet();
  private state: HubState = "idle";
  private attempts = 0;

  constructor(private readonly options: PgRunNotifierOptions) {}

  subscribe(
    filter: NotifyFilter,
    handler: NotificationHandler,
    onResync: () => void = () => {},
  ): () => void {
    const unsubscribe = this.set.add({ filter, handler, onResync });

    void this.ensureListening();

    return unsubscribe;
  }

  /** True once the LISTEN is in place; false when the attempt failed (a reconnect is already scheduled) or another attempt is in flight. */
  private async ensureListening(): Promise<boolean> {
    if (this.state !== "idle") {
      return false;
    }
    this.state = "connecting";

    try {
      await this.listen();

      return true;
    } catch (err) {
      this.onLost(err);

      return false;
    }
  }

  private async listen(): Promise<void> {
    const client = this.options.connect();

    client.on("notification", (msg) => this.onNotification(msg.payload));
    client.on("error", (err) => this.onLost(err));
    client.on("end", () => this.onLost(new Error("connection ended")));
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    this.state = "listening";
    this.log("listening on " + NOTIFY_CHANNEL);
  }

  private onNotification(payload: string | undefined): void {
    const notification = parseNotification(payload ?? "");

    if (notification !== null) {
      this.set.dispatch(notification);
    }
  }

  /** Reconnects with capped backoff; the resync fires once the new connection listens, so a subscriber re-reads its snapshot only when notifications can reach it again. */
  private onLost(err: unknown): void {
    const wasListening = this.state === "listening";

    this.state = "idle";
    this.attempts += wasListening ? 0 : 1;
    this.log(`connection lost: ${(err as Error).message}`);
    const delay = Math.min(
      RECONNECT_CAP_MS,
      RECONNECT_BASE_MS * 2 ** Math.max(0, this.attempts - 1),
    );

    (this.options.schedule ?? setTimeout)(() => void this.reconnect(), delay);
  }

  private async reconnect(): Promise<void> {
    if (this.state !== "idle" || this.set.size === 0) {
      return;
    }

    if (await this.ensureListening()) {
      this.attempts = 0;
      this.set.resyncAll();
    }
  }

  private log(message: string): void {
    (this.options.log ?? console.error)(`[run-stream] ${message}`);
  }
}

/** The process-wide notifier, built from the same env the pool reads. */
export function connectFromEnv(): ListenClient {
  return new pg.Client({
    host: process.env.LORE_DB_HOST,
    port: parseInt(process.env.LORE_DB_PORT || "5432", 10),
    database: process.env.LORE_DB_NAME || "lore",
    user: process.env.LORE_DB_USER || "postgres",
    password: process.env.LORE_DB_PASSWORD,
  }) as unknown as ListenClient;
}

let notifierSingleton: PgRunNotifier | undefined;

export const pgRunNotifier = (): PgRunNotifier =>
  (notifierSingleton ??= new PgRunNotifier({ connect: connectFromEnv }));
