import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/platform/db.js", () => ({
  getHealthStatus: vi.fn().mockResolvedValue({ connected: true }),
  isDbAvailable: vi.fn(),
  getQueryEmbedding: vi.fn(),
}));

const originalEnv = { ...process.env };

describe("rate-limit ext", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("routes /api/embed to its own 1200/min bucket — the per-statement projector burst must not starve (or be starved by) the 200/min default", async () => {
    const { bucketFor } = await import("./rate-limit.js");
    const { rateLimit } = await import("../../api/routes/auth.js");

    expect(bucketFor("/api/embed")).toBe("embed");

    for (let i = 0; i < 1200; i++) {
      expect(rateLimit("embed")).toBe(true);
    }
    expect(rateLimit("embed")).toBe(false);
    expect(rateLimit("default")).toBe(true);
  });

  it("routes /api/webhook/github and /api/task-turns/x to webhook and turns buckets", async () => {
    const { bucketFor } = await import("./rate-limit.js");

    expect(bucketFor("/api/webhook/github")).toBe("webhook");
    expect(bucketFor("/api/task-turns/abc-123")).toBe("turns");
    expect(bucketFor("/api/task")).toBe("task");
    expect(bucketFor("/api/task/abc-123")).toBe("task");
    expect(bucketFor("/api/tasks")).toBe("task");
    expect(bucketFor("/api/repo-status")).toBe("default");
  });

  it("trips the default bucket at the 201st request on a native route (/dist)", async () => {
    const server = buildServer(() => null);
    const hit = () =>
      server.inject({
        method: "GET",
        url: "/dist/lore-code-trace/linux-amd64",
      });

    for (let i = 0; i < 200; i++) {
      await hit();
    }
    const last = await hit();

    expect(last.statusCode).toBe(429);
    expect(last.result).toEqual({ error: "rate limit exceeded" });
    expect(last.headers["retry-after"]).toBe("60");
  });

  it("trips the task bucket at the 61st POST to a native route (/api/task)", async () => {
    const server = buildServer(() => null);
    const hit = () =>
      server.inject({
        method: "POST",
        url: "/api/task",
        headers: AUTH,
        payload: "{}",
      });

    for (let i = 0; i < 60; i++) {
      await hit();
    }
    const last = await hit();

    expect(last.statusCode).toBe(429);
  });

  it("counts each request once — the 200th passes and the 201st trips", async () => {
    const server = buildServer(() => null);
    const hit = () =>
      server.inject({
        method: "GET",
        url: "/api/repo-status?repo=o/r",
        headers: AUTH,
      });
    let secondToLast;

    for (let i = 0; i < 200; i++) {
      secondToLast = await hit();
    }
    const last = await hit();

    expect(secondToLast!.statusCode).not.toBe(429);
    expect(last.statusCode).toBe(429);
  });

  it("exempts /healthz from rate limiting", async () => {
    const server = buildServer(() => null);
    const hit = () => server.inject({ method: "GET", url: "/healthz" });

    for (let i = 0; i < 249; i++) {
      await hit();
    }
    const last = await hit();

    expect(last.statusCode).not.toBe(429);
  });
});
