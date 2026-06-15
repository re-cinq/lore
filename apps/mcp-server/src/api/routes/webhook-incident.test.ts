import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock } from "../../test-helpers/http-mock.js";

const originalEnv = { ...process.env };

async function run(body: unknown, pool: any = null) {
  const res = makeRes();
  await handleApiRoute(makeReq({ url: "/api/webhook/incident", method: "POST", body }), res, pool);
  return res;
}

describe("POST /api/webhook/incident", () => {
  useRateLimitSafeClock();
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = await run({ repo: "o/r" }, null);
    expect(res.statusCode).toBe(503);
  });
  it("returns 400 when no repo can be resolved", async () => {
    const res = await run({ incident: {} }, makePool() as any);
    expect(res.statusCode).toBe(400);
  });
  it("upserts a direct-format incident", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await run({ repo: "o/r", title: "down", severity: "high", url: "u" }, pool as any);
    expect(res.json).toEqual({ ok: true, repo: "o/r" });
  });
  it("maps a PagerDuty/Opsgenie envelope", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await run(
      { incident: { service: { name: "o/r" }, summary: "API down", urgency: "high", status: "resolved", html_url: "https://pd/1" } },
      pool as any,
    );
    expect(res.json).toEqual({ ok: true, repo: "o/r" });
  });
  it("returns 500 when the upsert throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db fail"));
    const res = await run({ repo: "o/r" }, pool as any);
    expect(res.statusCode).toBe(500);
  });
  it("returns 500 on a malformed JSON body", async () => {
    const res = await run("{not json", makePool() as any);
    expect(res.statusCode).toBe(500);
  });
  it("derives resolved=true from status resolved and writes a FIFO-capped entry", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = await run({ repo: "o/r", title: "outage", status: "resolved" }, pool as any);
    expect(res.json).toEqual({ ok: true, repo: "o/r" });
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toContain("LIMIT 10");
    expect(JSON.parse(args[1])).toMatchObject({ title: "outage", resolved: true, severity: "unknown" });
  });
  it("defaults title and severity when neither incident field is present", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    await run({ repo: "o/r" }, pool as any);
    const [, args] = pool.query.mock.calls[0];
    expect(JSON.parse(args[1])).toMatchObject({ title: "Unknown incident", severity: "unknown", resolved: false });
  });
});
