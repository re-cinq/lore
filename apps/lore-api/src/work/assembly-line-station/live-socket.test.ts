import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { InMemoryRunNotifier } from "./run-notify-hub.js";
import { memoryLiveTokens } from "./live-tokens.js";
import { RunFeedRegistry } from "./run-feed.js";
import { mountLiveSocket, type LiveSocketMount } from "./live-socket.js";
import type { CollabServer, TunnelSocket } from "./plan-channel.js";
import {
  base64ToBytes,
  bytesToBase64,
  MAX_CHANNELS_PER_SOCKET,
  type LiveServerMessage,
} from "./protocol.js";
import {
  insertAgentEvents,
  readDeps,
  seedRun,
  type Seed,
} from "./run-stream-session.test.js";

const REFUSE_BYTE = 0xff;

function echoingCollabThatRefusesOnByte(): CollabServer {
  return {
    handleConnection: (socket: TunnelSocket) => ({
      handleMessage: (bytes) =>
        bytes[0] === REFUSE_BYTE
          ? socket.close(4401, "Unauthorized")
          : socket.send(bytes),
      handleClose: () => {},
    }),
  };
}

function queuedClient(port: number, path = "/api/ws") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  const queue: LiveServerMessage[] = [];
  const waiters: ((m: LiveServerMessage) => void)[] = [];

  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as LiveServerMessage;
    const waiter = waiters.shift();

    if (waiter) {
      waiter(message);

      return;
    }
    queue.push(message);
  });

  return {
    ws,
    open: () =>
      new Promise<void>((resolve) => ws.once("open", () => resolve())),
    send: (message: object) => ws.send(JSON.stringify(message)),
    next: () =>
      new Promise<LiveServerMessage>((resolve) => {
        const queued = queue.shift();

        if (queued) {
          resolve(queued);

          return;
        }
        waiters.push(resolve);
      }),
    closed: () => new Promise<number>((resolve) => ws.once("close", resolve)),
  };
}

const decodedBytes = (message: LiveServerMessage): unknown =>
  message.type === "data" ? base64ToBytes(message.data) : message;

const frameTypeOf = (message: LiveServerMessage): string =>
  message.type === "frame" ? message.frame.type : message.type;

async function untilCatchup(
  c: ReturnType<typeof queuedClient>,
): Promise<string[]> {
  const types: string[] = [];

  for (;;) {
    const message = await c.next();

    types.push(frameTypeOf(message));

    if (message.type === "frame" && message.frame.type === "catchup_complete") {
      return types;
    }
  }
}

describe("the live socket", () => {
  let http: Server;
  let port: number;
  let mount: LiveSocketMount;
  let seed: Seed;
  let tokens: ReturnType<typeof memoryLiveTokens>;
  let notifier: InMemoryRunNotifier;
  let feeds: RunFeedRegistry;
  const opened: ReturnType<typeof queuedClient>[] = [];

  const connect = async () => {
    const c = queuedClient(port);

    opened.push(c);
    await c.open();

    return c;
  };

  const runToken = () =>
    tokens.mint({
      kind: "run",
      subject: seed.run.id,
      user: { id: "ana", name: "Ana" },
    });

  const openRun = (
    c: ReturnType<typeof queuedClient>,
    channel = "r",
    after?: string,
  ) =>
    c.send({
      type: "open",
      channel,
      kind: "run",
      subject: seed.run.id,
      token: runToken(),
      after,
    });

  beforeEach(async () => {
    seed = await seedRun();
    tokens = memoryLiveTokens();
    notifier = new InMemoryRunNotifier();
    feeds = new RunFeedRegistry({ ...readDeps(seed), notifier });
    http = createServer((_, res) => res.end("ok"));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    port = (http.address() as { port: number }).port;
    mount = mountLiveSocket(http, {
      run: { verifyToken: tokens.verify, runs: seed.runs, feeds },
      collab: echoingCollabThatRefusesOnByte(),
      pingMs: 50,
      log: () => {},
    });
  });

  afterEach(async () => {
    for (const c of opened.splice(0)) {
      c.ws.terminate();
    }
    mount.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it("opens a run channel and delivers its snapshot, replay and catchup_complete as frame envelopes", async () => {
    await insertAgentEvents(seed.events, 1);
    const c = await connect();

    openRun(c);

    expect({ first: await c.next(), then: await untilCatchup(c) }).toEqual({
      first: { type: "opened", channel: "r" },
      then: [
        "run_status",
        "node_status",
        "task_event",
        "task_event",
        "ci_check",
        "agent_event",
        "catchup_complete",
      ],
    });
  });

  it("forwards a live notification to two channels on two sockets, then closes the feed when both close", async () => {
    const one = await connect();
    const two = await connect();

    openRun(one);
    openRun(two);
    await untilCatchup(one);
    await untilCatchup(two);
    await seed.runs.finish(seed.run.id, "success");
    notifier.publish({ kind: "run_status", run: seed.run.id });
    const forwarded = [await one.next(), await two.next()];

    one.send({ type: "close", channel: "r" });
    const closed = await one.next();
    const afterOne = feeds.subscriberCount(seed.run.id);

    two.ws.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect({ forwarded, closed, afterOne, afterBoth: feeds.feedCount }).toEqual(
      {
        forwarded: [
          expect.objectContaining({
            type: "frame",
            channel: "r",
            frame: expect.objectContaining({ type: "run_status" }),
          }),
          expect.objectContaining({
            type: "frame",
            channel: "r",
            frame: expect.objectContaining({ type: "run_status" }),
          }),
        ],
        closed: { type: "closed", channel: "r", reason: "client" },
        afterOne: 1,
        afterBoth: 0,
      },
    );
  });

  it("tunnels plan bytes both ways and relays the collaboration server's close", async () => {
    const c = await connect();
    const exchange = [
      { type: "open", channel: "p", kind: "plan", subject: "plan:o/r:1" },
      {
        type: "send",
        channel: "p",
        data: bytesToBase64(new Uint8Array([1, 2, 3])),
      },
      {
        type: "send",
        channel: "p",
        data: bytesToBase64(new Uint8Array([REFUSE_BYTE])),
      },
      { type: "send", channel: "p", data: "AA==" },
    ];
    const replies: LiveServerMessage[] = [];

    for (const message of exchange) {
      c.send(message);
      replies.push(await c.next());
    }

    expect(replies.map(decodedBytes)).toEqual([
      { type: "opened", channel: "p" },
      new Uint8Array([1, 2, 3]),
      { type: "closed", channel: "p", reason: "unauthorized", code: 4401 },
      { type: "error", channel: "p", code: "unknown_channel" },
    ]);
  });

  it("answers a malformed message, an unknown channel, a reused id and a channel past the cap with errors", async () => {
    const c = await connect();
    const fill = Array.from({ length: MAX_CHANNELS_PER_SOCKET }, (_, i) => ({
      type: "open",
      channel: `p${i}`,
      kind: "plan",
      subject: "plan:o/r:1",
    }));
    const exchange = [
      { type: "dance" },
      { type: "close", channel: "nope" },
      ...fill,
      { type: "open", channel: "p0", kind: "plan", subject: "plan:o/r:1" },
      {
        type: "open",
        channel: "one-more",
        kind: "plan",
        subject: "plan:o/r:1",
      },
    ];
    const replies: LiveServerMessage[] = [];

    for (const message of exchange) {
      c.send(message);
      replies.push(await c.next());
    }

    expect([replies[0], replies[1], ...replies.slice(-2)]).toEqual([
      { type: "error", code: "bad_message" },
      { type: "error", channel: "nope", code: "unknown_channel" },
      { type: "error", channel: "p0", code: "channel_in_use" },
      { type: "error", channel: "one-more", code: "too_many_channels" },
    ]);
  });

  it("closes a run channel as unauthorized for a bad token, leaving the socket usable", async () => {
    const c = await connect();

    c.send({
      type: "open",
      channel: "r",
      kind: "run",
      subject: seed.run.id,
      token: "forged",
    });

    expect(await c.next()).toEqual({
      type: "closed",
      channel: "r",
      reason: "unauthorized",
    });
    openRun(c);

    expect(await c.next()).toEqual({ type: "opened", channel: "r" });
  });

  it("leaves a foreign upgrade path to the mount that owns it", async () => {
    http.on("upgrade", (request, socket) => {
      if (request.url === "/api/plans/collab") {
        socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      }
    });
    const foreign = queuedClient(port, "/api/plans/collab");
    const status = await new Promise<number>((resolve) => {
      foreign.ws.once("unexpected-response", (_, res) =>
        resolve(res.statusCode ?? 0),
      );
      foreign.ws.once("error", () => resolve(-1));
    });

    expect(status).toBe(404);
    expect(mount.connectionCount).toBe(0);
  });

  it("terminates a socket that stops answering pings and closes its channels", async () => {
    const c = await connect();

    openRun(c);
    await c.next();
    c.ws.pause();
    const code = await new Promise<number>((resolve) => {
      c.ws.once("close", resolve);
      setTimeout(() => c.ws.resume(), 200);
    });

    expect(code).toBe(1006);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(feeds.feedCount).toBe(0);
  });
});
