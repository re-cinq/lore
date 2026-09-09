import { describe, it, expect, afterEach } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { LoreClient } from "./lore-client.js";

let server: Server | undefined;

afterEach(
  () => new Promise<void>((r) => (server ? server.close(() => r()) : r())),
);

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  const addr = server.address();

  enforceTrue(
    !(addr === null || typeof addr === "string"),
    Error,
    "no server address",
  );

  return `http://127.0.0.1:${addr.port}`;
}

describe("LoreClient", () => {
  it("returns the parsed JSON body on a successful first attempt", async () => {
    const baseUrl = await startServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer tok-1");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ specs: ["a", "b"] }));
    });
    const client = new LoreClient(baseUrl, "tok-1");

    expect(await client.specs("owner/repo")).toEqual({ specs: ["a", "b"] });
  });

  it("throws immediately without retrying a non-retriable status", async () => {
    let requestCount = 0;
    const baseUrl = await startServer((req, res) => {
      requestCount++;
      res.statusCode = 400;
      res.end("bad request");
    });
    const client = new LoreClient(baseUrl, "tok-1");

    await expect(client.specs("owner/repo")).rejects.toThrow(
      /Lore API GET .* failed: HTTP 400/,
    );
    expect(requestCount).toBe(1);
  });

  it("retries a retriable status and returns the body once it succeeds", async () => {
    let requestCount = 0;
    const baseUrl = await startServer((req, res) => {
      requestCount++;

      if (requestCount === 1) {
        res.statusCode = 503;
        res.end("unavailable");

        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ specs: ["ok"] }));
    });
    const client = new LoreClient(baseUrl, "tok-1");

    expect(await client.specs("owner/repo")).toEqual({ specs: ["ok"] });
    expect(requestCount).toBe(2);
  }, 10_000);

  it("recovers from a network error on retry", async () => {
    let requestCount = 0;
    const baseUrl = await startServer((req, res) => {
      requestCount++;

      if (requestCount === 1) {
        req.destroy();

        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ specs: ["recovered"] }));
    });
    const client = new LoreClient(baseUrl, "tok-1");

    expect(await client.specs("owner/repo")).toEqual({ specs: ["recovered"] });
    expect(requestCount).toBe(2);
  }, 10_000);

  it("throws after exhausting all retries on a persistently retriable status", async () => {
    let requestCount = 0;
    const baseUrl = await startServer((req, res) => {
      requestCount++;
      res.statusCode = 502;
      res.end("bad gateway");
    });
    const client = new LoreClient(baseUrl, "tok-1");

    await expect(client.specs("owner/repo")).rejects.toThrow(
      /Lore API GET .* failed: HTTP 502/,
    );
    expect(requestCount).toBe(4);
  }, 10_000);
});
