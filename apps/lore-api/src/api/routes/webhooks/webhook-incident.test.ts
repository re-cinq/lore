import { describe, it, expect, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { makePool, useRateLimitSafeClock } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const post = (body: unknown, pool: unknown = null) => {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return buildServer(() => pool as any).inject({ method: "POST", url: "/api/webhook/incident", payload });
};

describe("POST /api/webhook/incident", () => {
  useRateLimitSafeClock();
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = await post({ repo: "o/r" }, null);
    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when no repo can be resolved", async () => {
    const res = await post({ incident: {} }, makePool());
    expect(res.statusCode).toBe(400);
  });

  it("upserts a direct-format incident", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await post({ repo: "o/r", title: "down", severity: "high", url: "u" }, pool);
    expect(res.result).toEqual({ ok: true, repo: "o/r" });
  });

  it("maps a PagerDuty/Opsgenie envelope", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await post(
      { incident: { service: { name: "o/r" }, summary: "API down", urgency: "high", status: "resolved", html_url: "https://pd/1" } },
      pool,
    );
    expect(res.result).toEqual({ ok: true, repo: "o/r" });
  });

  it("returns 500 when the upsert throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db fail"));
    const res = await post({ repo: "o/r" }, pool);
    expect(res.statusCode).toBe(500);
  });

  it("returns 500 on a malformed JSON body", async () => {
    const res = await post("{not json", makePool());
    expect(res.statusCode).toBe(500);
  });

  it("derives resolved=true from status resolved and writes a FIFO-capped entry", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await post({ repo: "o/r", title: "outage", status: "resolved" }, pool);
    expect(res.result).toEqual({ ok: true, repo: "o/r" });
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toContain("LIMIT 10");
    expect(JSON.parse(args[1])).toMatchObject({ title: "outage", resolved: true, severity: "unknown" });
  });

  it("defaults title and severity when neither incident field is present", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    await post({ repo: "o/r" }, pool);
    const [, args] = pool.query.mock.calls[0];
    expect(JSON.parse(args[1])).toMatchObject({ title: "Unknown incident", severity: "unknown", resolved: false });
  });
});
