// FR-303: one dedicated LISTEN connection per lore-api replica, outside the pool, hands each session id the database announces to the same listeners an in-process session end reaches. A lost connection reconnects after a delay; the five-minute check (FR-305) covers the gap.

import {
  connectFromEnv,
  type ListenClient,
} from "../assembly-line-station/run-notify-hub.js";
import { announceSessionEnded } from "./session-ended.js";

export const SESSION_ENDED_CHANNEL = "lore_session_ended";

const RECONNECT_MS = 5_000;

export interface SessionEndedListenerOptions {
  connect?: () => ListenClient;
  reconnectMs?: number;
}

class SessionEndedListener {
  private stopped = false;
  private client: ListenClient | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: SessionEndedListenerOptions) {}

  async open(): Promise<void> {
    try {
      const client = (this.options.connect ?? connectFromEnv)();

      this.client = client;
      client.on("notification", (msg) => {
        if (msg.payload) {
          announceSessionEnded(msg.payload);
        }
      });
      client.on("error", () => this.retry());
      client.on("end", () => this.retry());
      await client.connect();
      await client.query(`LISTEN ${SESSION_ENDED_CHANNEL}`);
    } catch {
      this.retry();
    }
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    void this.client?.end().catch(() => undefined);
  }

  private retry(): void {
    this.client = undefined;

    if (this.stopped || this.timer !== undefined) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.open();
    }, this.options.reconnectMs ?? RECONNECT_MS);
    this.timer.unref();
  }
}

/** Starts listening and returns the stop function. */
export function listenForSessionEnds(
  options: SessionEndedListenerOptions = {},
): () => void {
  const listener = new SessionEndedListener(options);

  void listener.open();

  return () => listener.stop();
}
