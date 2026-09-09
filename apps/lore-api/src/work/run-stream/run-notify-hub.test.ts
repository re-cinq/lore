import { describe, it, expect, vi } from "vitest";
import {
  InMemoryRunNotifier,
  MAX_SUBSCRIBERS_PER_RUN,
  PgRunNotifier,
  matchesFilter,
  parseNotification,
  type ListenClient,
  type NotifyFilter,
  type RunNotification,
} from "./run-notify-hub.js";

const filter: NotifyFilter = {
  runId: "run-1",
  taskId: "task-1",
  repo: "o/r",
  prNumber: 12,
};

describe("parseNotification", () => {
  it("reads a trigger payload into a notification with string ids", () => {
    expect(
      parseNotification('{"kind":"node_status","run":"run-1","row":42}'),
    ).toEqual({
      kind: "node_status",
      run: "run-1",
      row: "42",
      task: undefined,
      id: undefined,
      repo: undefined,
      pr: undefined,
    });
  });

  it("returns null for an unknown kind, a body that is not JSON, and a JSON null", () => {
    expect(parseNotification('{"kind":"weather"}')).toBeNull();
    expect(parseNotification("not json")).toBeNull();
    expect(parseNotification("null")).toBeNull();
  });
});

describe("matchesFilter", () => {
  it("matches run-keyed kinds on the run id only", () => {
    expect(matchesFilter({ kind: "agent_event", run: "run-1" }, filter)).toBe(
      true,
    );
    expect(matchesFilter({ kind: "node_status", run: "run-2" }, filter)).toBe(
      false,
    );
  });

  it("matches a task event on the task id and never when the run has no task", () => {
    expect(matchesFilter({ kind: "task_event", task: "task-1" }, filter)).toBe(
      true,
    );
    expect(
      matchesFilter(
        { kind: "task_event", task: "task-1" },
        { ...filter, taskId: null },
      ),
    ).toBe(false);
  });

  it("matches a CI check on repo and PR number, and never when the run has no PR", () => {
    const check: RunNotification = { kind: "ci_check", repo: "o/r", pr: "12" };

    expect(matchesFilter(check, filter)).toBe(true);
    expect(matchesFilter({ ...check, pr: "13" }, filter)).toBe(false);
    expect(matchesFilter(check, { ...filter, prNumber: null })).toBe(false);
  });
});

describe("InMemoryRunNotifier", () => {
  it("delivers a published notification only to subscribers whose filter matches", () => {
    const hub = new InMemoryRunNotifier();
    const mine = vi.fn();
    const theirs = vi.fn();

    hub.subscribe(filter, mine);
    hub.subscribe({ ...filter, runId: "run-2" }, theirs);
    hub.publish({ kind: "run_status", run: "run-1" });

    expect(mine).toHaveBeenCalledTimes(1);
    expect(theirs).not.toHaveBeenCalled();
  });

  it("stops delivery after unsubscribe and keeps the other subscribers", () => {
    const hub = new InMemoryRunNotifier();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = hub.subscribe(filter, first);

    hub.subscribe(filter, second);
    unsubscribe();
    hub.publish({ kind: "run_status", run: "run-1" });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("rejects a subscriber past the per-run cap", () => {
    const hub = new InMemoryRunNotifier();

    for (let i = 0; i < MAX_SUBSCRIBERS_PER_RUN; i++) {
      hub.subscribe(filter, () => {});
    }

    expect(() => hub.subscribe(filter, () => {})).toThrow(
      new Error(
        `run stream: run-1 already has ${MAX_SUBSCRIBERS_PER_RUN} subscribers`,
      ),
    );
  });

  it("keeps delivering to the remaining subscribers when one throws", () => {
    const hub = new InMemoryRunNotifier();
    const after = vi.fn();

    hub.subscribe(filter, () => {
      throw new Error("boom");
    });
    hub.subscribe(filter, after);
    hub.publish({ kind: "run_status", run: "run-1" });

    expect(after).toHaveBeenCalledTimes(1);
  });
});

interface FakeClient extends ListenClient {
  listeners: Map<string, (arg: never) => void>;
  queries: string[];
  emit(event: string, arg: unknown): void;
}

function fakeClient(connect: () => Promise<void> = async () => {}): FakeClient {
  const listeners = new Map<string, (arg: never) => void>();
  const queries: string[] = [];

  return {
    listeners,
    queries,
    connect,
    query: async (text: string) => {
      queries.push(text);
    },
    on: (event: string, listener: (arg: never) => void) => {
      listeners.set(event, listener);
    },
    end: async () => {},
    emit: (event, arg) => listeners.get(event)?.(arg as never),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("PgRunNotifier", () => {
  it("opens one LISTEN connection on the first subscriber and dispatches its notifications", async () => {
    const client = fakeClient();
    const hub = new PgRunNotifier({ connect: () => client, log: () => {} });
    const handler = vi.fn();

    hub.subscribe(filter, handler);
    hub.subscribe(filter, () => {});
    await flush();
    client.emit("notification", {
      payload: '{"kind":"run_status","run":"run-1"}',
    });

    expect(client.queries).toEqual(["LISTEN lore_run_stream"]);
    expect(handler).toHaveBeenCalledWith({
      kind: "run_status",
      run: "run-1",
      row: undefined,
      task: undefined,
      id: undefined,
      repo: undefined,
      pr: undefined,
    });
  });

  it("reconnects after the connection errors and tells every subscriber to resync", async () => {
    const clients = [fakeClient(), fakeClient()];
    let next = 0;
    const scheduled: Array<() => void> = [];
    const hub = new PgRunNotifier({
      connect: () => clients[next++],
      schedule: (fn) => scheduled.push(fn),
      log: () => {},
    });
    const onResync = vi.fn();

    hub.subscribe(filter, () => {}, onResync);
    await flush();
    clients[0].emit("error", new Error("terminated"));
    scheduled.shift()?.();
    await flush();

    expect(clients[1].queries).toEqual(["LISTEN lore_run_stream"]);
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("backs off and retries when the connection attempt itself fails", async () => {
    const attempts: Array<() => void> = [];
    const delays: number[] = [];
    let calls = 0;
    const hub = new PgRunNotifier({
      connect: () =>
        fakeClient(async () => {
          calls += 1;

          throw new Error("refused");
        }),
      schedule: (fn, delayMs) => {
        attempts.push(fn);
        delays.push(delayMs);
      },
      log: () => {},
    });

    hub.subscribe(filter, () => {});
    await flush();
    attempts.shift()?.();
    await flush();

    expect(calls).toBe(2);
    expect(delays).toEqual([1000, 2000]);
  });
});
