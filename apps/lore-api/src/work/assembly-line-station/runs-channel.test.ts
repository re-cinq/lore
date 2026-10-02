import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { FloorRunsFeed } from "../floor/floor-runs-feed.js";
import { controllableWatch, row } from "../floor/floor-runs-feed.fixtures.js";
import { memoryLiveTokens } from "./live-tokens.js";
import { mountLiveSocket, type LiveSocketMount } from "./live-socket.js";
import { queuedClient } from "./live-socket.fixtures.js";

describe("the runs channel", () => {
  let http: Server;
  let mount: LiveSocketMount;

  afterEach(async () => {
    await mount.close();
    http.close();
  });

  it("sends opened, run-1's row, then run_started for run-7 to a browser watching run-1", async () => {
    const floor = controllableWatch();
    const run1 = row({ id: "run-1" });
    const feed = new FloorRunsFeed({
      watchFloor: () => floor.watch,
      rowOf: async () => run1,
    });
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
    client.send({
      type: "open",
      channel: "c1",
      kind: "runs",
      subject: "floor",
      token: tokens.mint({
        kind: "runs",
        subject: "floor",
        user: { id: "ana", name: "Ana" },
      }),
    });
    const opened = await client.next();

    client.send({ type: "watch", channel: "c1", runs: ["run-1"] });
    const rowFrame = await client.next();

    floor.say({ type: "run_started", runId: "run-7" });
    const started = await client.next();

    client.ws.close();

    expect([opened, rowFrame, started]).toEqual([
      { type: "opened", channel: "c1" },
      { type: "runs", channel: "c1", frame: { type: "run_row", run: run1 } },
      {
        type: "runs",
        channel: "c1",
        frame: { type: "run_started", run_id: "run-7" },
      },
    ]);
  });
});
