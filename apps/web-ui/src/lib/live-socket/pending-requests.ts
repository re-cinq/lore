import type { LiveClientMessage } from "./protocol";

export interface RequestAnswer {
  status: number;
  body: unknown;
}

export type RequestMethod = "GET" | "POST" | "PUT" | "DELETE";

const TIMEOUT_MS = 30_000;

interface Waiting {
  message: Extract<LiveClientMessage, { type: "request" }>;
  resolve: (answer: RequestAnswer) => void;
  reject: (error: Error) => void;
  sent: boolean;
}

export interface PendingRequestsDeps {
  isLive(): boolean;
  send(message: LiveClientMessage): void;
  /** The tab's own timer when absent. */
  startTimer?: (fn: () => void, delayMs: number) => unknown;
  /** The first request is waiting: the socket must be up for it. */
  onBusy(): void;
  /** Nothing is waiting any more. */
  onIdle(): void;
}

/** The requests asked of the socket and not yet answered. A GET survives a dropped socket and is sent again; any other method is refused on a drop, since a write must not be repeated blindly. */
export class PendingRequests {
  private readonly waiting = new Map<string, Waiting>();
  private nextId = 0;

  constructor(private readonly deps: PendingRequestsDeps) {}

  ask(
    method: RequestMethod,
    path: string,
    body?: unknown,
  ): Promise<RequestAnswer> {
    const id = `r${++this.nextId}`;

    return new Promise((resolve, reject) => {
      const message = { type: "request" as const, id, method, path, body };

      if (this.waiting.size === 0) {
        this.deps.onBusy();
      }
      this.waiting.set(id, { message, resolve, reject, sent: false });
      this.transmit(id);
      (this.deps.startTimer ?? setTimeout)(
        () => this.fail(id, new Error("timed out")),
        TIMEOUT_MS,
      );
    });
  }

  /** The socket is up: whatever has not gone out yet goes now. */
  flush(): void {
    for (const id of this.waiting.keys()) {
      this.transmit(id);
    }
  }

  deliver(id: string, answer: RequestAnswer): void {
    this.waiting.get(id)?.resolve(answer);
    this.settle(id);
  }

  dropped(): void {
    for (const [id, entry] of [...this.waiting]) {
      entry.sent = false;

      if (entry.message.method !== "GET") {
        this.fail(id, new Error("connection lost"));
      }
    }
  }

  private transmit(id: string): void {
    const entry = this.waiting.get(id);

    if (entry === undefined || entry.sent || !this.deps.isLive()) {
      return;
    }
    entry.sent = true;
    this.deps.send(entry.message);
  }

  private fail(id: string, error: Error): void {
    this.waiting.get(id)?.reject(error);
    this.settle(id);
  }

  private settle(id: string): void {
    if (this.waiting.delete(id) && this.waiting.size === 0) {
      this.deps.onIdle();
    }
  }
}
