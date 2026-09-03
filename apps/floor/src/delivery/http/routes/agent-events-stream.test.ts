import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { PassThrough } from "node:stream";
import { registerBearerAuth } from "../auth.js";
import {
  sseComment,
  sseFrame,
  parseCursor,
  streamRunEvents,
  agentEventsStreamRoute,
} from "./agent-events-stream.js";
import { MAX_BUFFERED_EVENTS } from "../../../jobs/agent/agent-event-bus.js";
import type { AgentEventHandler } from "../../../jobs/agent/agent-event-bus.js";
import type { AgentRunEventRow } from "@re-cinq/lore-shared";

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  vi.useRealTimers();

  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;

    return;
  }
  process.env.LORE_INGEST_TOKEN = ORIG;
});

function row(
  id: string,
  over: Partial<AgentRunEventRow> = {},
): AgentRunEventRow {
  return {
    id,
    taskId: "task-1",
    agentCrName: "05fc5491-implement",
    assemblyLineId: "line-1",
    stationRunId: null,
    nodeId: "implement",
    iteration: 1,
    eventType: "tool_call",
    toolName: "Edit",
    toolUseId: "tu-1",
    isError: false,
    filePaths: ["src/foo.ts"],
    summary: "Edit src/foo.ts",
    payload: {},
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
    ...over,
  };
}

interface FakeBus {
  subscribe: (
    assemblyLineId: string,
    handler: AgentEventHandler,
    onOverflow?: () => void,
  ) => () => void;
  publish: (rows: AgentRunEventRow[]) => void;
  overflow: () => void;
  count: () => number;
  lines: () => string[];
}

function fakeBus(): FakeBus {
  const subs: {
    line: string;
    handler: AgentEventHandler;
    onOverflow: () => void;
  }[] = [];

  return {
    subscribe: (line, handler, onOverflow = () => {}) => {
      const entry = { line, handler, onOverflow };

      subs.push(entry);

      return () => {
        const i = subs.indexOf(entry);

        if (i >= 0) {
          subs.splice(i, 1);
        }
      };
    },
    publish: (rows) => subs.forEach((s) => s.handler(rows)),
    overflow: () => subs.forEach((s) => s.onOverflow()),
    count: () => subs.length,
    lines: () => subs.map((s) => s.line),
  };
}

function collect(stream: PassThrough): () => string {
  let out = "";

  stream.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });

  return () => out;
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function pagedEvents(rows: AgentRunEventRow[]) {
  return {
    listSince: (assemblyLineId: string, afterId: string, limit: number) =>
      Promise.resolve(
        rows
          .filter(
            (r) =>
              r.assemblyLineId === assemblyLineId &&
              BigInt(r.id) > BigInt(afterId),
          )
          .slice(0, limit),
      ),
  };
}

describe("sseFrame", () => {
  it("frames a row as id, event and data lines terminated by a blank line", () => {
    const frame = sseFrame(row("42"));
    const lines = frame.split("\n");

    expect(lines[0]).toBe("id: 42");
    expect(lines[1]).toBe("event: agent-event");
    expect(lines[2]?.startsWith("data: {")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("serializes createdAt as an ISO string in the data payload", () => {
    const payload = sseFrame(row("42")).split("\n")[2]?.slice("data: ".length);

    expect(JSON.parse(payload ?? "{}")).toMatchObject({
      id: "42",
      assemblyLineId: "line-1",
      createdAt: "2026-07-20T10:00:00.000Z",
    });
  });
});

describe("sseComment", () => {
  it("frames a comment with a leading colon and a blank line", () => {
    expect(sseComment("ping")).toBe(": ping\n\n");
  });
});

describe("parseCursor", () => {
  it("returns the Last-Event-ID header when both header and after query are present", () => {
    expect(parseCursor("99", "7")).toBe("99");
  });

  it("returns the after query param when no Last-Event-ID header", () => {
    expect(parseCursor(undefined, "7")).toBe("7");
  });

  it("returns 0 when neither cursor is supplied", () => {
    expect(parseCursor(undefined, undefined)).toBe("0");
  });

  it("returns 0 for a non-numeric cursor", () => {
    expect(parseCursor("not-a-number", undefined)).toBe("0");
  });
});

describe("streamRunEvents", () => {
  it("replays seeded rows in ascending id order before catchup-complete", async () => {
    const stream = new PassThrough();
    const text = collect(stream);
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([row("1"), row("2"), row("3")]),
      bus: fakeBus(),
    });

    await ready;
    await flush();

    const ids = [...text().matchAll(/^id: (\d+)$/gm)].map((m) => m[1]);

    expect(ids).toEqual(["1", "2", "3"]);
    expect(text().indexOf("id: 3")).toBeLessThan(
      text().indexOf("event: catchup-complete"),
    );
  });

  it("pages listSince until a short page drains the backlog", async () => {
    const stream = new PassThrough();
    const text = collect(stream);
    const events = pagedEvents([
      row("1"),
      row("2"),
      row("3"),
      row("4"),
      row("5"),
    ]);
    const listSince = vi.fn(events.listSince);
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: { listSince },
      bus: fakeBus(),
      pageSize: 2,
    });

    await ready;
    await flush();

    expect([...text().matchAll(/^id: (\d+)$/gm)].map((m) => m[1])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(listSince).toHaveBeenCalledTimes(3);
  });

  it("emits catchup-complete carrying the last replayed id", async () => {
    const stream = new PassThrough();
    const text = collect(stream);
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([row("1"), row("2")]),
      bus: fakeBus(),
    });

    await ready;
    await flush();

    expect(text()).toContain(
      'event: catchup-complete\ndata: {"lastId":"2"}\n\n',
    );
  });

  it("delivers a live row published after catchup", async () => {
    const stream = new PassThrough();
    const text = collect(stream);
    const bus = fakeBus();
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([row("1")]),
      bus,
    });

    await ready;
    bus.publish([row("2")]);
    await flush();

    expect([...text().matchAll(/^id: (\d+)$/gm)].map((m) => m[1])).toEqual([
      "1",
      "2",
    ]);
  });

  it("subscribes before replay so a row published during replay is not lost", async () => {
    const stream = new PassThrough();
    const text = collect(stream);
    const bus = fakeBus();
    const seeded = pagedEvents([row("1")]);
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: {
        listSince: async (line, after, limit) => {
          bus.publish([row("2")]);

          return seeded.listSince(line, after, limit);
        },
      },
      bus,
    });

    await ready;
    await flush();

    expect([...text().matchAll(/^id: (\d+)$/gm)].map((m) => m[1])).toEqual([
      "1",
      "2",
    ]);
  });

  it("drops a live row whose id was already replayed", async () => {
    const stream = new PassThrough();
    const text = collect(stream);
    const bus = fakeBus();
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([row("1"), row("2")]),
      bus,
    });

    await ready;
    bus.publish([row("2"), row("3")]);
    await flush();

    expect([...text().matchAll(/^id: (\d+)$/gm)].map((m) => m[1])).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("scopes the replay to the assemblyLineId in the path, not to the cursor alone", async () => {
    const stream = new PassThrough();
    const text = collect(stream);
    const bus = fakeBus();
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([
        row("1"),
        row("2", { assemblyLineId: "line-2" }),
        row("3"),
      ]),
      bus,
    });

    await ready;
    await flush();

    expect([...text().matchAll(/^id: (\d+)$/gm)].map((m) => m[1])).toEqual([
      "1",
      "3",
    ]);
    expect(bus.lines()).toEqual(["line-1"]);
  });

  it("writes a ping comment every 25 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const stream = new PassThrough();
    const text = collect(stream);
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([]),
      bus: fakeBus(),
    });

    await ready;
    vi.advanceTimersByTime(75_000);
    await flush();

    expect(text().match(/: ping\n\n/g)).toHaveLength(3);
  });

  it("unsubscribes and clears the heartbeat when the client disconnects", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const stream = new PassThrough();
    const bus = fakeBus();
    const { ready, teardown } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([]),
      bus,
    });

    await ready;
    expect(bus.count()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    teardown();

    expect(bus.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(stream.writableEnded).toBe(true);
  });

  it("ends the stream when buffered bytes exceed the high-water mark", async () => {
    const stream = new PassThrough();
    const bus = fakeBus();
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([row("1")]),
      bus,
      highWaterMark: 8,
    });

    await ready;

    expect(stream.writableEnded).toBe(true);
    expect(bus.count()).toBe(0);
  });

  it("ends the stream when rows buffered during catch-up exceed the bus cap", async () => {
    const stream = new PassThrough();
    const text = collect(stream);
    const bus = fakeBus();
    const seeded = pagedEvents([row("1")]);
    const burst = Array.from({ length: MAX_BUFFERED_EVENTS + 1 }, (_, i) =>
      row(String(100 + i)),
    );
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: {
        listSince: async (line, after, limit) => {
          bus.publish(burst);

          return seeded.listSince(line, after, limit);
        },
      },
      bus,
    });

    await ready;
    await flush();

    expect(stream.writableEnded).toBe(true);
    expect(bus.count()).toBe(0);
    expect(text()).not.toContain("catchup-complete");
  });

  it("ends the stream when the bus drops the subscriber on overflow", async () => {
    const stream = new PassThrough();

    collect(stream);
    const bus = fakeBus();
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([]),
      bus,
    });

    await ready;
    bus.overflow();

    expect(stream.writableEnded).toBe(true);
  });

  it("unsubscribes when the stream errors", async () => {
    const stream = new PassThrough();

    collect(stream);
    stream.on("error", () => {});
    const bus = fakeBus();
    const { ready } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: pagedEvents([]),
      bus,
    });

    await ready;
    stream.emit("error", new Error("socket gone"));

    expect(bus.count()).toBe(0);
  });

  it("stops replaying when the client disconnects mid-catchup", async () => {
    const stream = new PassThrough();
    const text = collect(stream);
    let teardownRef = (): void => {};
    const seeded = pagedEvents([row("1"), row("2")]);
    const { ready, teardown } = streamRunEvents(stream, {
      assemblyLineId: "line-1",
      after: "0",
      events: {
        listSince: async (line, after, limit) => {
          await Promise.resolve();
          teardownRef();

          return seeded.listSince(line, after, limit);
        },
      },
      bus: fakeBus(),
    });

    teardownRef = teardown;
    await ready;
    await flush();

    expect(text()).toBe("");
  });
});

function streamServer(deps: Parameters<typeof agentEventsStreamRoute>[0]) {
  const server = Hapi.server({ port: 0 });

  registerBearerAuth(server);
  server.route(agentEventsStreamRoute(deps));

  return server;
}

const idleDeps = {
  events: { listSince: () => Promise.resolve([]) },
  bus: fakeBus(),
};

describe("GET /api/agent-events/stream/{assemblyLineId}", () => {
  it("returns 401 when the bearer token does not match", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await streamServer(idleDeps).inject({
      method: "GET",
      url: "/api/agent-events/stream/line-1",
      headers: { authorization: "Bearer wrong" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns text/event-stream with no-cache no-transform and X-Accel-Buffering no", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const bus = fakeBus();
    const server = streamServer({
      events: { listSince: () => Promise.resolve([]) },
      bus,
      heartbeatMs: 25_000,
    });
    const injected = server.inject({
      method: "GET",
      url: "/api/agent-events/stream/line-1",
      headers: {
        authorization: "Bearer ingest-secret",
        "accept-encoding": "gzip",
      },
    });

    await flush();
    await flush();
    bus.overflow();
    const res = await injected;

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    expect(res.headers["content-encoding"]).toBe("identity");
    expect(res.payload).toContain("event: catchup-complete");
  });

  it("returns 503 when the line already has its maximum subscribers", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await streamServer({
      events: { listSince: () => Promise.resolve([]) },
      bus: {
        subscribe: () => {
          throw new Error("agent event bus: line-1 already has 20 subscribers");
        },
      },
    }).inject({
      method: "GET",
      url: "/api/agent-events/stream/line-1",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(res.statusCode).toBe(503);
  });

  it("returns 500, not 503, when subscribe fails for a reason other than capacity", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const res = await streamServer({
      events: { listSince: () => Promise.resolve([]) },
      bus: {
        subscribe: () => {
          throw new TypeError("handler is not a function");
        },
      },
    }).inject({
      method: "GET",
      url: "/api/agent-events/stream/line-1",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(res.statusCode).toBe(500);
  });
});
