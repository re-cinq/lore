import { afterEach, describe, expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { postBackfill } from "./lore-api-backfill.js";

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
}

async function loreApi(
  answer: (res: ServerResponse) => void,
): Promise<{ baseUrl: string; seen: Seen }> {
  const seen: Seen = {};
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    Object.assign(seen, {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });
    answer(res);
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
    });
  });

  it("rejects with no answer within 50ms when lore-api holds the call past the timeout", async () => {
    const { baseUrl } = await loreApi(() => undefined);

    await expect(
      postBackfill({ baseUrl, timeoutMs: 50 }, "re-cinq/lore"),
    ).rejects.toThrow(new Error("no answer within 50ms"));
  });
});
