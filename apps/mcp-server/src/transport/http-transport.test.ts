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

  it("400s a GET /mcp with an unknown session id", async () => {
    const base = start({ port: 0 });
    const res = await fetch(`${base}/mcp`, {
      headers: { "mcp-session-id": "does-not-exist" },
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
});
