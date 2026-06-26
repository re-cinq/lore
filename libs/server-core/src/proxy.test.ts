import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { proxyToApi, proxyGetApi } from "./proxy.js";

// Failure-mapping unit tests for the proxy client (the data path the lean
// mcp-server uses to reach lore-api). The in-process proxy<->lore-api
// integration test cannot reach the server-side denial branch — client and
// server share LORE_INGEST_TOKEN there — so the 401/403 -> "denied" and the
// 4xx -> "unreachable" mappings are pinned here with a mocked fetch instead.

function fetchReturning(response: { ok: boolean; status?: number; statusText?: string; json?: () => Promise<unknown> }) {
  return vi.fn().mockResolvedValue(response);
}

describe("proxy client result mapping", () => {
  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.test";
    process.env.LORE_INGEST_TOKEN = "token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LORE_API_URL;
    delete process.env.LORE_INGEST_TOKEN;
  });

  it("returns not_configured when LORE_API_URL is unset", async () => {
    delete process.env.LORE_API_URL;
    expect(await proxyToApi("/api/task", {})).toEqual({ ok: false, reason: "not_configured" });
  });

  it("returns not_configured when LORE_INGEST_TOKEN is unset", async () => {
    delete process.env.LORE_INGEST_TOKEN;
    expect(await proxyGetApi("/api/repos")).toEqual({ ok: false, reason: "not_configured" });
  });

  it("returns ok with the serialized body on 200", async () => {
    global.fetch = fetchReturning({ ok: true, json: async () => ({ hello: "world" }) }) as typeof fetch;
    expect(await proxyToApi("/api/task", { a: 1 })).toEqual({ ok: true, body: JSON.stringify({ hello: "world" }) });
  });

  it("forwards the bearer token and endpoint on a POST", async () => {
    const spy = fetchReturning({ ok: true, json: async () => ({}) });
    global.fetch = spy as typeof fetch;
    await proxyToApi("/api/task", { a: 1 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://lore-api.test/api/task");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer token" });
  });

  it("maps 403 to denied without retrying", async () => {
    const spy = fetchReturning({ ok: false, status: 403, statusText: "Forbidden" });
    global.fetch = spy as typeof fetch;
    expect(await proxyGetApi("/api/repos")).toMatchObject({ ok: false, reason: "denied" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps 401 to denied without retrying", async () => {
    const spy = fetchReturning({ ok: false, status: 401, statusText: "Unauthorized" });
    global.fetch = spy as typeof fetch;
    expect(await proxyToApi("/api/task", {})).toMatchObject({ ok: false, reason: "denied" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps a non-retriable 4xx to unreachable without retrying", async () => {
    const spy = fetchReturning({ ok: false, status: 400, statusText: "Bad Request" });
    global.fetch = spy as typeof fetch;
    expect(await proxyToApi("/api/task", {})).toMatchObject({ ok: false, reason: "unreachable" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
