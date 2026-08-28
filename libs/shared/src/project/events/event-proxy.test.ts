import { describe, it, expect } from "vitest";
import { EventProxy, queuedReporter } from "./event-proxy.js";
import type { EventInput, ProxyMessage, Sink } from "./event-input-port.js";
import type { EventInsert } from "../../events.js";

const anEvent = (name: string): EventInsert => ({
  eventName: name,
  source: "kubernetes",
});

const refusal = (status: number): Error =>
  Object.assign(new Error(`event insert failed: ${status}`), { status });

/** A sink that records what it was handed and fails on demand. */
function fakeSink(failures: Array<Error | null> = []): Sink & {
  delivered: ProxyMessage[];
} {
  const delivered: ProxyMessage[] = [];

  return {
    delivered,
    deliver: async (message) => {
      const failure = failures.shift();

      if (failure) {
        throw failure;
      }
      delivered.push(message);
    },
  };
}

/** A sink that never resolves, so the queue backs up. */
function wedgedSink(): Sink {
  return { deliver: () => new Promise<void>(() => {}) };
}

/** Whether a promise has settled, without waiting on it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol("pending");

  return (await Promise.race([promise, Promise.resolve(pending)])) !== pending;
}

/** Let the drain loop run its queued microtasks. */
const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function build(
  over: Partial<ConstructorParameters<typeof EventProxy>[0]> = {},
): {
  proxy: EventProxy;
  events: ReturnType<typeof fakeSink>;
  telemetry: ReturnType<typeof fakeSink>;
  logs: string[];
} {
  const events = fakeSink();
  const telemetry = fakeSink();
  const logs: string[] = [];

  const proxy = new EventProxy({
    sinks: { event: events, telemetry },
    capacity: 2,
    retry: { attempts: 3, delayMs: 1 },
    sleep: () => Promise.resolve(),
    log: (line) => logs.push(line),
    ...over,
  });

  return { proxy, events, telemetry, logs };
}

describe("insert — the synchronous path", () => {
  it("delivers straight to the event sink without queueing, so a caller can answer 202", async () => {
    const { proxy, events } = build();

    await proxy.insert(anEvent("github.pull_request.opened"));

    expect(events.delivered).toEqual([
      { kind: "event", event: anEvent("github.pull_request.opened") },
    ]);
  });

  it("propagates the sink's failure, so an ingress route still answers 500 and the sender redelivers", async () => {
    const events = fakeSink([refusal(503)]);
    const { proxy } = build({
      sinks: { event: events, telemetry: fakeSink() },
    });

    await expect(proxy.insert(anEvent("ci.tests.reported"))).rejects.toThrow(
      "event insert failed: 503",
    );
  });
});

describe("emit — the queued path", () => {
  it("resolves before the sink has delivered, so a producer is never held by the wire", async () => {
    const { proxy, events } = build();

    await proxy.emit({
      kind: "event",
      event: anEvent("kubernetes.agent.succeeded"),
    });

    expect(events.delivered).toEqual([]);
  });

  it("delivers queued messages once started, in the order they were emitted", async () => {
    const { proxy, events } = build();

    await proxy.emit({ kind: "event", event: anEvent("first") });
    await proxy.emit({ kind: "event", event: anEvent("second") });
    await proxy.start();
    await tick();

    expect(
      events.delivered.map((m) => m.kind === "event" && m.event.eventName),
    ).toEqual(["first", "second"]);
  });

  it("routes each message to the sink for its kind, so telemetry never lands on the bus", async () => {
    const { proxy, events, telemetry } = build();

    await proxy.emit({ kind: "telemetry", body: '{"type":"tool_use"}' });
    await proxy.start();
    await tick();

    expect({
      events: events.delivered.length,
      telemetry: telemetry.delivered,
    }).toEqual({
      events: 0,
      telemetry: [{ kind: "telemetry", body: '{"type":"tool_use"}' }],
    });
  });

  it("blocks the producer once the queue is full, rather than growing without bound", async () => {
    const { proxy } = build({
      sinks: { event: wedgedSink(), telemetry: fakeSink() },
    });

    await proxy.emit({ kind: "event", event: anEvent("a") });
    await proxy.emit({ kind: "event", event: anEvent("b") });
    const blocked = proxy.emit({ kind: "event", event: anEvent("c") });

    expect(await settled(blocked)).toBe(false);
  });
});

describe("delivery failures", () => {
  it("retries a blip and reports the message on the next attempt", async () => {
    const events = fakeSink([refusal(503)]);
    const { proxy } = build({
      sinks: { event: events, telemetry: fakeSink() },
    });

    await proxy.emit({
      kind: "event",
      event: anEvent("kubernetes.agent.failed"),
    });
    await proxy.start();
    await tick();

    expect(events.delivered).toEqual([
      { kind: "event", event: anEvent("kubernetes.agent.failed") },
    ]);
  });

  it("re-registers once on a refused credential and the retry then lands", async () => {
    const events = fakeSink([refusal(401)]);
    let reRegistrations = 0;
    const { proxy } = build({
      sinks: { event: events, telemetry: fakeSink() },
      onUnauthorized: async () => {
        reRegistrations++;
      },
    });

    await proxy.emit({
      kind: "event",
      event: anEvent("kubernetes.agent.succeeded"),
    });
    await proxy.start();
    await tick();

    expect({ reRegistrations, delivered: events.delivered.length }).toEqual({
      reRegistrations: 1,
      delivered: 1,
    });
  });

  it("drops after the last attempt and names the message, because the symptom is otherwise silence", async () => {
    const events = fakeSink([refusal(503), refusal(503), refusal(503)]);
    const { proxy, logs } = build({
      sinks: { event: events, telemetry: fakeSink() },
    });

    await proxy.emit({
      kind: "event",
      event: anEvent("kubernetes.agent.failed"),
    });
    await proxy.start();
    await tick();

    expect(events.delivered).toEqual([]);
    expect(logs.join("\n")).toContain("kubernetes.agent.failed");
  });
});

describe("registered inputs", () => {
  it("starts every registered input with an emit bound to the queue", async () => {
    const { proxy, events } = build();
    const started: string[] = [];
    const input: EventInput = {
      name: "agent-watch",
      start: async (emit) => {
        started.push("agent-watch");
        await emit({
          kind: "event",
          event: anEvent("kubernetes.agent.succeeded"),
        });
      },
      stop: () => Promise.resolve(),
    };

    proxy.register(input);
    await proxy.start();
    await tick();

    expect({ started, delivered: events.delivered.length }).toEqual({
      started: ["agent-watch"],
      delivered: 1,
    });
  });

  it("stops every registered input on stop, so a rollout does not leave a watch running", async () => {
    const { proxy } = build();
    const stopped: string[] = [];
    const input = (name: string): EventInput => ({
      name,
      start: () => {},
      stop: async () => {
        stopped.push(name);
      },
    });

    proxy.register(input("agent-watch"));
    proxy.register(input("pod-logs"));
    await proxy.start();
    await proxy.stop(50);

    expect(stopped).toEqual(["agent-watch", "pod-logs"]);
  });
});

describe("stop", () => {
  it("drains what is queued and reports nothing left behind", async () => {
    const { proxy, events } = build();

    await proxy.emit({
      kind: "event",
      event: anEvent("kubernetes.agent.succeeded"),
    });
    await proxy.start();

    expect(await proxy.stop(50)).toBe(0);
    expect(events.delivered.length).toBe(1);
  });

  it("gives up at the deadline and reports what it could not deliver, so shutdown is bounded", async () => {
    let clock = 0;
    const { proxy } = build({
      sinks: { event: wedgedSink(), telemetry: fakeSink() },
      now: () => (clock += 100),
    });

    await proxy.emit({ kind: "event", event: anEvent("a") });
    await proxy.emit({ kind: "event", event: anEvent("b") });

    expect(await proxy.stop(50)).toBe(2);
  });
});

describe("queuedReporter", () => {
  it("queues what a port typed on EventReporter inserts, rather than delivering inline", async () => {
    const { proxy, events } = build();

    await queuedReporter(proxy).insert(anEvent("assembly_run.resume"));

    expect({ delivered: events.delivered.length, depth: proxy.depth }).toEqual({
      delivered: 0,
      depth: 1,
    });
  });
});
