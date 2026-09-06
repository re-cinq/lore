import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  proxyToApi,
  proxyGetApi,
  withReadCache,
  type ProxyResult,
} from "./proxy.js";

function fetchReturning(response: {
  ok: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}) {
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
    expect(await proxyToApi("/api/task", {})).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });

  it("returns not_configured when LORE_INGEST_TOKEN is unset", async () => {
    delete process.env.LORE_INGEST_TOKEN;
    expect(await proxyGetApi("/api/repos")).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });

  it("returns ok with the serialized body on 200", async () => {
    global.fetch = fetchReturning({
      ok: true,
      json: async () => ({ hello: "world" }),
    }) as typeof fetch;
    expect(await proxyToApi("/api/task", { a: 1 })).toEqual({
      ok: true,
      body: JSON.stringify({ hello: "world" }),
    });
  });

  it("forwards the bearer token and endpoint on a POST", async () => {
    const spy = fetchReturning({ ok: true, json: async () => ({}) });

    global.fetch = spy as typeof fetch;
    await proxyToApi("/api/task", { a: 1 });
    const [url, init] = spy.mock.calls[0];

    expect(url).toBe("https://lore-api.test/api/task");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer token",
    });
  });

  it("maps 403 to denied without retrying", async () => {
    const spy = fetchReturning({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    global.fetch = spy as typeof fetch;
    expect(await proxyGetApi("/api/repos")).toMatchObject({
      ok: false,
      reason: "denied",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps 401 to denied without retrying", async () => {
    const spy = fetchReturning({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    global.fetch = spy as typeof fetch;
    expect(await proxyToApi("/api/task", {})).toMatchObject({
      ok: false,
      reason: "denied",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps a non-retriable 4xx to unreachable without retrying", async () => {
    const spy = fetchReturning({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });

    global.fetch = spy as typeof fetch;
    expect(await proxyToApi("/api/task", {})).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("folds the server error body into the detail on a non-retriable 4xx", async () => {
    const spy = fetchReturning({
      ok: false,
      status: 424,
      statusText: "Failed Dependency",
      text: async () => JSON.stringify({ error: "GitHub not configured" }),
    });

    global.fetch = spy as typeof fetch;
    expect(await proxyGetApi("/api/pr-status")).toMatchObject({
      ok: false,
      reason: "unreachable",
      detail: "HTTP 424 Failed Dependency: GitHub not configured",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("carries the status and raw body of a non-retriable 4xx", async () => {
    const body = JSON.stringify({
      blocked: "in-flight",
      error: "o/r is already in flight",
      task_id: "task-9",
    });
    const spy = fetchReturning({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () => body,
    });

    global.fetch = spy as typeof fetch;
    expect(await proxyToApi("/api/onboard", {})).toMatchObject({
      ok: false,
      reason: "unreachable",
      status: 409,
      body,
    });
  });

  it("retries a retriable 503 and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    const spy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Busy" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ done: true }) });

    global.fetch = spy as unknown as typeof fetch;
    const pending = proxyGetApi("/api/repos");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({
      ok: true,
      body: JSON.stringify({ done: true }),
    });
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("exhausts every retry on a persistently retriable status and reports the last detail", async () => {
    vi.useFakeTimers();
    const spy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    global.fetch = spy as unknown as typeof fetch;
    const pending = proxyToApi("/api/task", {});

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({
      ok: false,
      reason: "unreachable",
      detail: "HTTP 500 Internal Server Error",
    });
    expect(spy).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("treats a thrown timeout error as retriable and reports the timeout message", async () => {
    vi.useFakeTimers();
    const timeoutError = Object.assign(new Error("aborted"), {
      name: "TimeoutError",
    });
    const spy = vi.fn().mockRejectedValue(timeoutError);

    global.fetch = spy as unknown as typeof fetch;
    const pending = proxyGetApi("/api/repos");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({
      ok: false,
      reason: "unreachable",
      detail: "request timed out (15s)",
    });
    vi.useRealTimers();
  });

  it("uses a thrown Error's own message when it is not a timeout", async () => {
    vi.useFakeTimers();
    const spy = vi.fn().mockRejectedValue(new Error("network down"));

    global.fetch = spy as unknown as typeof fetch;
    const pending = proxyToApi("/api/task", {});

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({
      ok: false,
      reason: "unreachable",
      detail: "network down",
    });
    vi.useRealTimers();
  });

  it("stringifies a non-Error thrown value when it carries no message", async () => {
    vi.useFakeTimers();
    const spy = vi.fn().mockRejectedValue("connection reset");

    global.fetch = spy as unknown as typeof fetch;
    const pending = proxyGetApi("/api/repos");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({
      ok: false,
      reason: "unreachable",
      detail: "connection reset",
    });
    vi.useRealTimers();
  });
});

describe("withReadCache", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "lore-proxy-cache-"));
    process.env.LORE_CACHE_DIR = cacheDir;
    delete process.env.LORE_CACHE_ENABLED;
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    delete process.env.LORE_CACHE_DIR;
    delete process.env.LORE_CACHE_ENABLED;
  });

  const policy = {
    tool: "lore_search_memory",
    args: { query: "auth" },
    repo: "re-cinq/lore",
    ttlSeconds: 60,
  };

  it("bypasses the cache entirely when no policy is given", async () => {
    let calls = 0;
    const result = await withReadCache(undefined, async () => {
      calls++;

      return { ok: true, body: "fresh" };
    });

    expect(result).toEqual({ ok: true, body: "fresh" });
    expect(calls).toBe(1);
  });

  it("stores a successful proxied read and serves it as a fresh hit next time", async () => {
    let calls = 0;
    const doProxy = async (): Promise<ProxyResult> => {
      calls++;

      return { ok: true, body: "results" };
    };

    await withReadCache(policy, doProxy);
    const second = await withReadCache(policy, doProxy);

    expect(second).toEqual({
      ok: true,
      body: "<!-- lore-cache: HIT, age 0s -->\nresults",
    });
    expect(calls).toBe(1);
  });

  it("does not store when cacheIf rejects the body", async () => {
    await withReadCache(policy, async () => ({ ok: true, body: "skip-me" }), {
      cacheIf: () => false,
    });
    let secondCalls = 0;
    const second = await withReadCache(
      policy,
      async () => {
        secondCalls++;

        return { ok: true, body: "skip-me" };
      },
      { cacheIf: () => false },
    );

    expect(secondCalls).toBe(1);
    expect(second).toEqual({ ok: true, body: "skip-me" });
  });

  it("serves a labeled stale copy when the backend is unreachable and a cached entry exists", async () => {
    const expiredPolicy = { ...policy, ttlSeconds: 0 };

    await withReadCache(expiredPolicy, async () => ({
      ok: true,
      body: "cached",
    }));
    const staleResult = await withReadCache(expiredPolicy, async () => ({
      ok: false,
      reason: "unreachable",
      detail: "down",
    }));

    expect(staleResult).toEqual({
      ok: true,
      body: expect.stringContaining("lore-cache: STALE"),
    });
    expect((staleResult as { body: string }).body).toContain("cached");
  });

  it("returns the unreachable result unchanged when no stale copy exists", async () => {
    const result = await withReadCache(policy, async () => ({
      ok: false,
      reason: "unreachable",
      detail: "down",
    }));

    expect(result).toEqual({
      ok: false,
      reason: "unreachable",
      detail: "down",
    });
  });

  it("passes a denied result straight through without serving any cached copy", async () => {
    const expiredPolicy = { ...policy, ttlSeconds: 0 };

    await withReadCache(expiredPolicy, async () => ({
      ok: true,
      body: "cached",
    }));
    const denied = await withReadCache(expiredPolicy, async () => ({
      ok: false,
      reason: "denied",
      detail: "token revoked",
    }));

    expect(denied).toEqual({
      ok: false,
      reason: "denied",
      detail: "token revoked",
    });
  });

  it("omits the HIT/STALE label when opts.label is false", async () => {
    await withReadCache(policy, async () => ({ ok: true, body: "results" }));
    const hit = await withReadCache(
      policy,
      async () => ({ ok: true, body: "results" }),
      { label: false },
    );

    expect(hit).toEqual({ ok: true, body: "results" });
  });

  it("omits the STALE label on a stale-copy serve when opts.label is false", async () => {
    const expiredPolicy = { ...policy, ttlSeconds: 0 };

    await withReadCache(expiredPolicy, async () => ({
      ok: true,
      body: "cached",
    }));
    const stale = await withReadCache(
      expiredPolicy,
      async () => ({ ok: false, reason: "unreachable", detail: "down" }),
      { label: false },
    );

    expect(stale).toEqual({ ok: true, body: "cached" });
  });
});
