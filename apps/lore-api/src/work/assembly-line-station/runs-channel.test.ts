import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { FloorRunsFeed } from "../floor/floor-runs-feed.js";
import {
  controllableWatch,
  row,
  until,
} from "../floor/floor-runs-feed.fixtures.js";
import { memoryLiveTokens } from "./live-tokens.js";
import { mountLiveSocket, type LiveSocketMount } from "./live-socket.js";
import { queuedClient } from "./live-socket.fixtures.js";

const ANA = { id: "ana", name: "Ana" };

describe("the runs channel", () => {
  let http: Server;
  let mount: LiveSocketMount;

  afterEach(async () => {
    await mount.close();
    http.close();
  });

  async function connect(feed: FloorRunsFeed | null) {
    const tokens = memoryLiveTokens();
    const unused = () => {
      throw new Error("not used by the runs channel");
    };

    http = createServer((_, res) => res.end("ok"));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    mount = mountLiveSocket(http, {
      run: {
        verifyToken: tokens.verify,
        runs: { getById: unused },
        feeds: { join: unused },
      },
      collab: { handleConnection: unused },
      runs: { verifyToken: tokens.verify, feed },
      pingMs: 50,
      log: () => {},
    });
    const client = queuedClient((http.address() as { port: number }).port);

    await client.open();

    return { client, tokens };
  }

  const openRuns = (
    { client, tokens }: Awaited<ReturnType<typeof connect>>,
    grant: { kind?: "run" | "runs"; subject?: string } = {},
  ) =>
    client.send({
      type: "open",
      channel: "c1",
      kind: "runs",
      subject: grant.subject ?? "floor",
      token: tokens.mint({
        kind: grant.kind ?? "runs",
        subject: grant.subject ?? "floor",
        user: ANA,
      }),
    });

  function feedOverFloor() {
    const floor = controllableWatch();
    const feed = new FloorRunsFeed({
      watchFloor: () => floor.watch,
      rowOf: async () => row({ id: "run-1" }),
    });

    return { floor, feed };
  }

  it("sends opened, run-1's row, then run_started for run-7 to a browser watching run-1", async () => {
    const { floor, feed } = feedOverFloor();
    const session = await connect(feed);
    const { client } = session;

    openRuns(session);
    const opened = await client.next();

    client.send({ type: "watch", channel: "c1", runs: ["run-1"] });
    const rowFrame = await client.next();

    floor.say({ type: "run_started", runId: "run-7" });
    const started = await client.next();

    client.ws.close();

    expect([opened, rowFrame, started]).toEqual([
      { type: "opened", channel: "c1" },
      {
        type: "runs",
        channel: "c1",
        frame: { type: "run_row", run: row({ id: "run-1" }) },
      },
      {
        type: "runs",
        channel: "c1",
        frame: { type: "run_started", run_id: "run-7" },
      },
    ]);
  });

  it("closes unauthorized for a token minted for kind run", async () => {
    const session = await connect(feedOverFloor().feed);

    openRuns(session, { kind: "run" });

    expect(await session.client.next()).toEqual({
      type: "closed",
      channel: "c1",
      reason: "unauthorized",
    });
  });

  it("closes unauthorized for a runs token on subject elsewhere", async () => {
    const session = await connect(feedOverFloor().feed);

    openRuns(session, { subject: "elsewhere" });

    expect(await session.client.next()).toEqual({
      type: "closed",
      channel: "c1",
      reason: "unauthorized",
    });
  });

  it("closes not_found when no floor is configured", async () => {
    const session = await connect(null);

    openRuns(session);

    expect(await session.client.next()).toEqual({
      type: "closed",
      channel: "c1",
      reason: "not_found",
    });
  });

  it("stops the floor watch and tells the client closed client when it closes the channel", async () => {
    const { floor, feed } = feedOverFloor();
    const session = await connect(feed);
    const { client } = session;

    openRuns(session);
    await client.next();
    client.send({ type: "close", channel: "c1" });
    const reply = await client.next();

    expect({ reply, stops: floor.stopCount() }).toEqual({
      reply: { type: "closed", channel: "c1", reason: "client" },
      stops: 1,
    });
  });

  it("stops the floor watch when the browser's socket closes", async () => {
    const { floor, feed } = feedOverFloor();
    const session = await connect(feed);
    const { client } = session;

    openRuns(session);
    await client.next();
    client.ws.close();
    await until(() => floor.stopCount() > 0);

    expect(floor.stopCount()).toEqual(1);
  });

  it("tells a viewer closed server when the floor watch ends", async () => {
    const { floor, feed } = feedOverFloor();
    const session = await connect(feed);
    const { client } = session;

    openRuns(session);
    await client.next();
    client.send({ type: "watch", channel: "c1", runs: ["run-1"] });
    await client.next();
    floor.endNow();

    expect(await client.next()).toEqual({
      type: "closed",
      channel: "c1",
      reason: "server",
    });
  });
});
