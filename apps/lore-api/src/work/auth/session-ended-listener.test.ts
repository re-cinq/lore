import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListenClient } from "../assembly-line-station/run-notify-hub.js";
import { onSessionEnded } from "./session-ended.js";
import { listenForSessionEnds } from "./session-ended-listener.js";

function fakeClient(connectError?: Error) {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  const queries: string[] = [];
  const client = {
    connect: async () => {
      if (connectError) {
        throw connectError;
      }
    },
    query: async (text: string) => {
      queries.push(text);
    },
    on: (event: string, listener: (arg?: unknown) => void) => {
      handlers[event] = listener;
    },
    end: async () => {},
  } as unknown as ListenClient;

  return { client, handlers, queries };
}

describe("listenForSessionEnds", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces the session id a database notification names to the in-process listeners", async () => {
    const fake = fakeClient();
    const ended: string[] = [];
    const unsubscribe = onSessionEnded((id) => ended.push(id));
    const stop = listenForSessionEnds({ connect: () => fake.client });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.handlers.notification?.({ payload: "session-42" });
    fake.handlers.notification?.({});
    stop();
    unsubscribe();

    expect({ ended, queries: fake.queries }).toEqual({
      ended: ["session-42"],
      queries: ["LISTEN lore_session_ended"],
    });
  });

  it("opens a new LISTEN connection after a lost or failed connection, once per loss, and stops reconnecting once stopped", async () => {
    vi.useFakeTimers();
    const first = fakeClient();
    const failed = fakeClient(new Error("db unavailable"));
    const third = fakeClient();
    const clients = [first.client, failed.client, third.client];
    const opened: number[] = [];
    const stop = listenForSessionEnds({
      connect: () => {
        opened.push(opened.length + 1);

        return clients.shift() as ListenClient;
      },
      reconnectMs: 50,
    });

    await vi.advanceTimersByTimeAsync(0);
    first.handlers.end?.();
    first.handlers.error?.();
    await vi.advanceTimersByTimeAsync(100);
    third.handlers.end?.();
    stop();
    third.handlers.error?.();
    await vi.advanceTimersByTimeAsync(200);

    expect({
      opened,
      firstQueries: first.queries,
      failedQueries: failed.queries,
      thirdQueries: third.queries,
    }).toEqual({
      opened: [1, 2, 3],
      firstQueries: ["LISTEN lore_session_ended"],
      failedQueries: [],
      thirdQueries: ["LISTEN lore_session_ended"],
    });
  });
});
