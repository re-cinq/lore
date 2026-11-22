import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { InMemoryRunNotifier } from "./run-notify-hub.js";
import { memoryLiveTokens } from "./live-tokens.js";
import { RunFeedRegistry } from "./run-feed.js";
import {
  allowing,
  cookieOf,
  personBySession,
  queuedClient,
} from "./live-socket.fixtures.js";
import type { SocketInject } from "./socket-request.js";
import {
  mountLiveSocket,
  type LiveSocketDeps,
  type LiveSocketMount,
} from "./live-socket.js";
import type { CollabServer, TunnelSocket } from "./plan-channel.js";
import type { PlanRunChannelDeps } from "./plan-run-channel.js";
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
  let inject: SocketInject;

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

  const planRunDeps = (): PlanRunChannelDeps => ({
    verifyToken: tokens.verify,
    planExists: async (planId) => planId === "p1",
    planRuns: async () => [seed.run],
    runs: seed.runs,
    prStatus: async () => ({ title: "Spec: checkout", unresolved_threads: 0 }),
    feeds,
    watch: null,
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
      runs: { verifyToken: tokens.verify, feed: null },
      planRun: planRunDeps(),
      collab: echoingCollabThatRefusesOnByte(),
      person: personBySession,
      inject: (options) => inject(options),
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

  const upgradeStatus = (
    headers: Record<string, string> = {},
  ): Promise<number> => {
    const attempt = queuedClient(port, "/api/ws", headers);

    opened.push(attempt);

    return new Promise<number>((resolve) => {
      attempt.ws.once("open", () => resolve(101));
      attempt.ws.once("unexpected-response", (_, res) =>
        resolve(res.statusCode ?? 0),
      );
      attempt.ws.once("error", () => {});
    });
  };

  const remount = (extra: Partial<LiveSocketDeps>) => {
    mount.close();
    mount = mountLiveSocket(http, {
      run: { verifyToken: tokens.verify, runs: seed.runs, feeds },
      runs: { verifyToken: tokens.verify, feed: null },
      planRun: planRunDeps(),
      collab: echoingCollabThatRefusesOnByte(),
      person: personBySession,
      inject: (options) => inject(options),
      log: () => {},
      ...extra,
    });
  };

  it("refuses an upgrade the limiter denies, with 429", async () => {
    remount({ limits: allowing(2, 0) });
    const statuses = [
      await upgradeStatus(),
      await upgradeStatus(),
      await upgradeStatus(),
    ];

    expect(statuses).toEqual([101, 101, 429]);
  });

  it("refuses an upgrade while the global socket ceiling is reached, with 503", async () => {
    remount({ maxSockets: 1 });
    const first = await upgradeStatus();
    const second = await upgradeStatus();

    expect({ first, second }).toEqual({ first: 101, second: 503 });
  });

  it("caps the sockets one address holds open and admits another once one closes", async () => {
    remount({ maxSocketsPerAddress: 2, limits: allowing(99, 0) });
    const held = [await connect(), await connect()];
    const refused = await upgradeStatus();

    held[0].ws.close();
    await held[0].closed();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const admitted = await upgradeStatus();

    expect({ refused, admitted }).toEqual({ refused: 429, admitted: 101 });
  });

  it("applies neither the per-address cap nor the upgrade rate when no trusted client address is known", async () => {
    remount({
      maxSocketsPerAddress: 1,
      limits: allowing(0, 0, null),
    });
    const statuses = [
      await upgradeStatus(),
      await upgradeStatus(),
      await upgradeStatus(),
    ];

    expect(statuses).toEqual([101, 101, 101]);
  });

  it("answers an open the limiter denies with a rate_limited error and opens no channel", async () => {
    remount({ limits: allowing(5, 1) });
    const c = await connect();

    openRun(c, "a");
    openRun(c, "b");
    let reply = await c.next();

    while (reply.type !== "error") {
      reply = await c.next();
    }

    expect(reply).toEqual({
      type: "error",
      channel: "b",
      code: "rate_limited",
    });
  });

  it("opens plan p1's plan-run channel: opened, the run's facts with its spec PR, then its status and visits with no agent event and no ci_check", async () => {
    await insertAgentEvents(seed.events, 3);
    const c = await connect();

    c.send({
      type: "open",
      channel: "pr",
      kind: "plan-run",
      subject: "p1",
      token: tokens.mint({
        kind: "plan-run",
        subject: "p1",
        user: { id: "ana", name: "Ana" },
      }),
    });

    expect({
      opened: await c.next(),
      facts: await c.next(),
      then: await untilCatchup(c),
    }).toMatchObject({
      opened: { type: "opened", channel: "pr" },
      facts: {
        type: "plan_run",
        channel: "pr",
        run: { id: seed.run.id, pr_number: 12, pr_title: "Spec: checkout" },
      },
      then: [
        "run_status",
        "node_status",
        "task_event",
        "task_event",
        "catchup_complete",
      ],
    });
  });

  it("refuses the upgrade of a cookie socket from https://evil.example with 403", async () => {
    const status = await upgradeStatus({
      ...cookieOf("ana-session"),
      origin: "https://evil.example",
    });

    expect({ status, sockets: mount.connectionCount }).toEqual({
      status: 403,
      sockets: 0,
    });
  });

  it("admits a socket with no cookie from any origin", async () => {
    expect(await upgradeStatus({ origin: "https://evil.example" })).toBe(101);
  });

  it("admits a cookie socket from an allowed origin", async () => {
    expect(await upgradeStatus(cookieOf("ana-session"))).toBe(101);
  });

  const asSession = async (session: string) => {
    const c = queuedClient(port, "/api/ws", cookieOf(session));

    opened.push(c);
    await c.open();

    return c;
  };

  it("answers a request on Ana's cookie socket with the route's status and body", async () => {
    inject = async ({ url, headers }) => ({
      statusCode: 200,
      payload: JSON.stringify({
        url,
        asAna: headers.authorization.endsWith("ana-session"),
      }),
    });
    const c = await asSession("ana-session");

    c.send({
      type: "request",
      id: "q1",
      method: "GET",
      path: "/api/floor-runs",
    });

    expect(await c.next()).toEqual({
      type: "response",
      id: "q1",
      status: 200,
      body: { url: "/api/floor-runs", asAna: true },
    });
  });

  it("keeps the socket open when a route throws", async () => {
    let calls = 0;

    inject = async () => {
      enforceTrue(calls++ !== 0, Error, "route exploded");

      return { statusCode: 200, payload: "{}" };
    };
    const c = await asSession("ana-session");
    const request = (id: string) =>
      c.send({ type: "request", id, method: "GET", path: "/api/x" });

    request("q1");
    const first = await c.next();

    request("q2");
    const second = await c.next();

    expect([first, second]).toMatchObject([
      { id: "q1", status: 500 },
      { id: "q2", status: 200 },
    ]);
  });

  const openRunWithoutToken = (c: ReturnType<typeof queuedClient>) =>
    c.send({ type: "open", channel: "r", kind: "run", subject: seed.run.id });

  it("opens run r1 for Ana's session with no token", async () => {
    const c = await asSession("ana-session");

    openRunWithoutToken(c);

    expect(await c.next()).toEqual({ type: "opened", channel: "r" });
  });

  it("closes run r1 as unauthorized for a socket with neither token nor session", async () => {
    const c = await connect();

    openRunWithoutToken(c);

    expect(await c.next()).toEqual({
      type: "closed",
      channel: "r",
      reason: "unauthorized",
    });
  });

  it("closes a run in a repo outside Ben's list as unauthorized", async () => {
    const c = await asSession("ben-session");

    openRunWithoutToken(c);

    expect(await c.next()).toEqual({
      type: "closed",
      channel: "r",
      reason: "unauthorized",
    });
  });

  it("closes only the sockets opened with the session row that ends", async () => {
    const ana = await asSession("ana-session");
    const ben = await asSession("ben-session");
    const anaClosed = ana.closed();

    await new Promise((resolve) => setTimeout(resolve, 20));
    mount.closeSession("row-ana");
    await anaClosed;

    expect({
      ana: ana.ws.readyState,
      ben: ben.ws.readyState,
    }).toEqual({ ana: 3, ben: 1 });
  });

  const mountWithPerson = async (person: LiveSocketDeps["person"]) => {
    const server = createServer((_, res) => res.end("ok"));

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const other = mountLiveSocket(server, {
      run: { verifyToken: tokens.verify, runs: seed.runs, feeds },
      runs: { verifyToken: tokens.verify, feed: null },
      planRun: planRunDeps(),
      collab: echoingCollabThatRefusesOnByte(),
      person,
      inject: (options) => inject(options),
      pingMs: 50,
      log: () => {},
    });
    const otherPort = (server.address() as { port: number }).port;
    const stop = async () => {
      other.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    };

    return { mount: other, port: otherPort, stop };
  };

  it("keeps every socket open when the ended session row is no socket's, the empty id or a cookie value", async () => {
    const ana = await asSession("ana-session");

    await new Promise((resolve) => setTimeout(resolve, 20));
    mount.closeSession("");
    mount.closeSession("ana-session");
    mount.closeSession("row-nobody");
    ana.send({ type: "request", id: "q1", method: "GET", path: "/api/x" });
    inject = async () => ({ statusCode: 200, payload: "{}" });

    expect({
      reply: await ana.next(),
      state: ana.ws.readyState,
    }).toEqual({
      reply: expect.objectContaining({ id: "q1", status: 200 }),
      state: 1,
    });
  });

  it("closes a socket whose session ends while its session row is still being looked up", async () => {
    let release: () => void = () => {};
    const looked = new Promise<void>((resolve) => (release = resolve));
    const slow = await mountWithPerson(async (token) => {
      await looked;

      return personBySession(token);
    });
    const ana = queuedClient(slow.port, "/api/ws", cookieOf("ana-session"));

    opened.push(ana);
    await ana.open();
    const anaClosed = ana.closed();

    slow.mount.closeSession("row-ana");
    release();
    const code = await Promise.race([
      anaClosed,
      new Promise((resolve) => setTimeout(() => resolve("still open"), 300)),
    ]);

    await slow.stop();
    expect(code).not.toBe("still open");
  });

  it("closes a socket by its session row even when the session lookup at upgrade failed", async () => {
    let calls = 0;
    const flaky = await mountWithPerson(async (token) => {
      enforceTrue(calls++ !== 0, Error, "session store unreachable");

      return personBySession(token);
    });
    const ana = queuedClient(flaky.port, "/api/ws", cookieOf("ana-session"));

    opened.push(ana);
    await ana.open();
    ana.send({
      type: "open",
      channel: "r",
      kind: "run",
      subject: seed.run.id,
    });
    const channel = await ana.next();
    const anaClosed = ana.closed();

    flaky.mount.closeSession("row-ana");
    const code = await Promise.race([
      anaClosed,
      new Promise((resolve) => setTimeout(() => resolve("still open"), 300)),
    ]);

    await flaky.stop();
    expect({ opened: channel, code }).toEqual({
      opened: { type: "opened", channel: "r" },
      code: expect.not.stringMatching("still open"),
    });
  });

  const probeStaleCheck = async (
    recheck: () => ReturnType<LiveSocketDeps["person"]>,
    waitMs = 500,
  ) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let calls = 0;
    const stale = await mountWithPerson(async (token) =>
      calls++ === 0 ? personBySession(token) : recheck(),
    );
    const ana = queuedClient(stale.port, "/api/ws", cookieOf("ana-session"));

    opened.push(ana);
    await ana.open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.setSystemTime(Date.now() + 6 * 60_000);
    const anaClosed = ana.closed();
    let served = 0;

    inject = async () => {
      served++;

      return { statusCode: 200, payload: "{}" };
    };
    ana.send({ type: "request", id: "q1", method: "GET", path: "/api/x" });
    const code = await Promise.race([
      anaClosed,
      new Promise((resolve) => setTimeout(() => resolve("still open"), waitMs)),
    ]);

    vi.useRealTimers();
    await stale.stop();

    return { code, served };
  };

  it("closes a socket whose person is no longer a member when a frame arrives after five minutes, serving nothing", async () => {
    expect(await probeStaleCheck(async () => null)).toEqual({
      code: 4401,
      served: 0,
    });
  });

  it("closes a stale socket with a reconnectable code when GitHub gives no answer at the check", async () => {
    expect(
      await probeStaleCheck(async () => {
        throw new Error("GitHub could not confirm org membership");
      }),
    ).toEqual({ code: 1013, served: 0 });
  });

  it("closes a stale socket with a reconnectable code when GitHub never answers the check, serving nothing", async () => {
    expect(
      await probeStaleCheck(() => new Promise<never>(() => {}), 2_500),
    ).toEqual({ code: 1013, served: 0 });
  });
});
