import { afterEach, describe, expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  loreApiTarget,
  postBackfill,
  postUtopiaCommits,
  postUtopiaReleases,
  postUtopiaTracker,
} from "./lore-api-backfill.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise((resolve) => server.close(resolve).closeAllConnections()),
      ),
  );
});

interface Seen {
  method?: string;
  url?: string;
  authorization?: string;
  body?: string;
}

async function loreApi(
  answer: (res: ServerResponse) => void,
): Promise<{ baseUrl: string; seen: Seen }> {
  const seen: Seen = {};
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      Object.assign(seen, {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      answer(res);
    });
  });

  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
  };
}

describe("postBackfill", () => {
  it("posts re-cinq/lore's backfill with the station token and answers lore-api's 409 status and body whole", async () => {
    const { baseUrl, seen } = await loreApi((res) =>
      res.writeHead(409).end('{"code":"utopia_not_set_up"}'),
    );

    expect(
      await postBackfill(
        { baseUrl, token: "tok-1", timeoutMs: 5_000 },
        "re-cinq/lore",
      ),
    ).toEqual({ status: 409, body: '{"code":"utopia_not_set_up"}' });
    expect(seen).toEqual({
      method: "POST",
      url: "/api/repos/re-cinq/lore/utopia/backfill",
      authorization: "Bearer tok-1",
      body: "",
    });
  });

  it("posts re-cinq/lore's commit walk for main as a JSON body with the station token and answers the 200 whole", async () => {
    const { baseUrl, seen } = await loreApi((res) =>
      res.writeHead(200).end('{"commits":0}'),
    );

    expect(
      await postUtopiaCommits(
        { baseUrl, token: "tok-1", timeoutMs: 5_000 },
        "re-cinq/lore",
        "main",
      ),
    ).toEqual({ status: 200, body: '{"commits":0}' });
    expect(seen).toEqual({
      method: "POST",
      url: "/api/repos/re-cinq/lore/utopia/commits",
      authorization: "Bearer tok-1",
      body: '{"branch":"main"}',
    });
  });

  it("posts re-cinq/lore's tracker walk with the station token and no body, and answers the 200 whole", async () => {
    const { baseUrl, seen } = await loreApi((res) =>
      res.writeHead(200).end('{"entries":0}'),
    );

    expect(
      await postUtopiaTracker(
        { baseUrl, token: "tok-1", timeoutMs: 5_000 },
        "re-cinq/lore",
      ),
    ).toEqual({ status: 200, body: '{"entries":0}' });
    expect(seen).toEqual({
      method: "POST",
      url: "/api/repos/re-cinq/lore/utopia/tracker",
      authorization: "Bearer tok-1",
      body: "",
    });
  });

  it("posts re-cinq/lore's release push with the station token and no body, and answers the 200 whole", async () => {
    const { baseUrl, seen } = await loreApi((res) =>
      res.writeHead(200).end('{"tags":0}'),
    );

    expect(
      await postUtopiaReleases(
        { baseUrl, token: "tok-1", timeoutMs: 5_000 },
        "re-cinq/lore",
      ),
    ).toEqual({ status: 200, body: '{"tags":0}' });
    expect(seen).toEqual({
      method: "POST",
      url: "/api/repos/re-cinq/lore/utopia/releases",
      authorization: "Bearer tok-1",
      body: "",
    });
  });

  it("reads lore-api's address and the station token from the environment, the ingest token failing that, and nothing without LORE_API_URL", () => {
    expect([
      loreApiTarget({ LORE_API_URL: "http://api", LORE_STATION_TOKEN: "st" }),
      loreApiTarget({ LORE_API_URL: "http://api", LORE_INGEST_TOKEN: "in" }),
      loreApiTarget({}),
    ]).toEqual([
      { baseUrl: "http://api", token: "st", timeoutMs: 1_800_000 },
      { baseUrl: "http://api", token: "in", timeoutMs: 1_800_000 },
      null,
    ]);
  });

  it("rejects with no answer within 50ms when lore-api holds the call past the timeout", async () => {
    const { baseUrl } = await loreApi(() => undefined);

    await expect(
      postBackfill({ baseUrl, timeoutMs: 50 }, "re-cinq/lore"),
    ).rejects.toThrow(new Error("no answer within 50ms"));
  });
});
