import { describe, it, expect, afterEach } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readJsonBody, startHttpGateway } from "./http-transport.js";

const bodyReq = (body: string | Buffer): IncomingMessage =>
  Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;

describe("readJsonBody", () => {
  it("parses a JSON object body", async () => {
    expect(await readJsonBody(bodyReq('{"a":1}'))).toEqual({ a: 1 });
  });

  it("returns undefined for an empty body", async () => {
    expect(await readJsonBody(bodyReq(""))).toBeUndefined();
  });

  it("throws 400 when the body is not valid JSON", async () => {
    await expect(readJsonBody(bodyReq("{not json"))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("throws 413 when the body exceeds 1 MB", async () => {
    const tooBig = Buffer.alloc(1024 * 1024 + 1, 0x61);

    await expect(readJsonBody(bodyReq(tooBig))).rejects.toMatchObject({
      status: 413,
    });
  });
});

describe("startHttpGateway routing", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => server?.close(() => resolve(undefined)));
    server = undefined;
  });

  function start(opts: Parameters<typeof startHttpGateway>[0]): string {
    server = startHttpGateway(opts);
    const { port } = server.address() as AddressInfo;

    return `http://127.0.0.1:${port}`;
  }

  const TEST_TIMEOUT_MS = 5000;

  it("answers /healthz without touching /mcp or /skills routing", async () => {
    const base = start({ port: 0 });
    const res = await fetch(`${base}/healthz`, {
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("falls through to the skills registry for a /skills path", async () => {
    const base = start({ port: 0 });
    const res = await fetch(`${base}/skills/settings.json`, {
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("hooks");
  });

  it("404s a path that is neither /healthz, /skills, nor /mcp", async () => {
    const base = start({ port: 0 });
    const res = await fetch(`${base}/nonexistent`, {
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(res.status).toBe(404);
  });

  it("401s an /mcp request missing the configured bearer token", async () => {
    const base = start({ port: 0, authToken: "secret" });
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(res.status).toBe(401);
  });

  it("400s a POST /mcp with no session and a non-initialize body", async () => {
    const base = start({ port: 0 });
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { error: { message: string } };

    expect(parsed.error.message).toContain("send initialize first");
  });

  it("400s a GET /mcp with no session id", async () => {
    const base = start({ port: 0 });
    const res = await fetch(`${base}/mcp`, {
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { error: { message: string } };

    expect(parsed.error.message).toContain("Unknown or missing session");
  });

  it("405s an unsupported method on /mcp", async () => {
    const base = start({ port: 0 });
    const res = await fetch(`${base}/mcp`, {
      method: "PUT",
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(res.status).toBe(405);
  });

  const postMcp = (
    base: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

  const initializeBody = {
    jsonrpc: "2.0",
    method: "initialize",
    id: 1,
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    },
  };

  it("404s a POST /mcp carrying an unknown session id so the client re-initializes", async () => {
    const base = start({ port: 0 });
    const res = await postMcp(
      base,
      { jsonrpc: "2.0", method: "tools/list", id: 1 },
      { "mcp-session-id": "does-not-exist" },
    );

    expect(res.status).toBe(404);
    const parsed = (await res.json()) as {
      error: { code: number; message: string };
    };

    expect(parsed.error).toEqual({
      code: -32001,
      message: "Session not found",
    });
  });

  it("404s a GET and a DELETE /mcp carrying an unknown session id", async () => {
    const base = start({ port: 0 });

    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${base}/mcp`, {
        method,
        headers: { "mcp-session-id": "does-not-exist" },
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });

      expect(res.status).toBe(404);
      const parsed = (await res.json()) as { error: { code: number } };

      expect(parsed.error.code).toBe(-32001);
    }
  });

  it("mints a fresh session on initialize after an unknown session 404", async () => {
    const base = start({ port: 0 });
    const stale = await postMcp(
      base,
      { jsonrpc: "2.0", method: "tools/list", id: 1 },
      { "mcp-session-id": "does-not-exist" },
    );
    const init = await postMcp(base, initializeBody);
    const sessionId = init.headers.get("mcp-session-id");

    expect(stale.status).toBe(404);
    expect(init.status).toBe(200);
    expect(sessionId).toBeTruthy();
  });

  it("keeps serving a live session and 404s it once it is deleted", async () => {
    const base = start({ port: 0 });
    const init = await postMcp(base, initializeBody);
    const sessionId = init.headers.get("mcp-session-id") ?? "";
    const headers = {
      "mcp-session-id": sessionId,
      "mcp-protocol-version": "2025-03-26",
    };
    const live = await postMcp(
      base,
      { jsonrpc: "2.0", method: "tools/list", id: 2 },
      headers,
    );
    const del = await fetch(`${base}/mcp`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const gone = await postMcp(
      base,
      { jsonrpc: "2.0", method: "tools/list", id: 3 },
      headers,
    );

    expect(live.status).toBe(200);
    expect(del.status).toBe(200);
    expect(gone.status).toBe(404);
  });

  it("400s a GET /mcp whose session id header is empty, as POST does", async () => {
    const base = start({ port: 0 });
    const res = await fetch(`${base}/mcp`, {
      headers: { "mcp-session-id": "" },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    expect(res.status).toBe(400);
  });
});
