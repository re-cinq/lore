import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const SECRET = "pd-webhook-secret";
const TOKEN = "opsgenie-shared-token";

const sign = (body: string) =>
  "v1=" + createHmac("sha256", SECRET).update(body).digest("hex");

const post = (
  body: unknown,
  {
    pool = null,
    headers = {},
  }: { pool?: unknown; headers?: Record<string, string> } = {},
) => {
  const payload = typeof body === "string" ? body : JSON.stringify(body);

  return buildServer(() => pool as any).inject({
    method: "POST",
    url: "/api/webhook/incident",
    payload,
    headers,
  });
};

const bearer = (body: unknown, pool: unknown = makePool()) =>
  post(body, { pool, headers: { authorization: `Bearer ${TOKEN}` } });

describe("POST /api/webhook/incident", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INCIDENT_WEBHOOK_TOKEN = TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when neither secret nor token is configured", async () => {
    delete process.env.LORE_INCIDENT_WEBHOOK_TOKEN;
    const res = await bearer({ repo: "o/r" });

    expect(res.statusCode).toBe(503);
    expect(res.result).toEqual({ error: "incident webhook not configured" });
  });

  it("returns 401 when no credentials are presented", async () => {
    const res = await post({ repo: "o/r" }, { pool: makePool() });

    expect(res.statusCode).toBe(401);
    expect(res.result).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when the bearer token does not match", async () => {
    const res = await post(
      { repo: "o/r" },
      { pool: makePool(), headers: { authorization: "Bearer wrong" } },
    );

    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid PagerDuty HMAC signature", async () => {
    delete process.env.LORE_INCIDENT_WEBHOOK_TOKEN;
    process.env.LORE_INCIDENT_WEBHOOK_SECRET = SECRET;
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const payload = JSON.stringify({ repo: "o/r", title: "down" });
    const res = await post(payload, {
      pool,
      headers: { "x-pagerduty-signature": sign(payload) },
    });

    expect(res.result).toEqual({ ok: true, repo: "o/r" });
  });

  it("accepts one signature among a rotated comma-delimited list", async () => {
    delete process.env.LORE_INCIDENT_WEBHOOK_TOKEN;
    process.env.LORE_INCIDENT_WEBHOOK_SECRET = SECRET;
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const payload = JSON.stringify({ repo: "o/r" });
    const res = await post(payload, {
      pool,
      headers: { "x-pagerduty-signature": `v1=deadbeef,${sign(payload)}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 401 when the HMAC signature does not match", async () => {
    delete process.env.LORE_INCIDENT_WEBHOOK_TOKEN;
    process.env.LORE_INCIDENT_WEBHOOK_SECRET = SECRET;
    const res = await post(JSON.stringify({ repo: "o/r" }), {
      pool: makePool(),
      headers: { "x-pagerduty-signature": "v1=deadbeef" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("accepts the token via the ?token= query fallback", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const res = await buildServer(() => pool as any).inject({
      method: "POST",
      url: `/api/webhook/incident?token=${TOKEN}`,
      payload: JSON.stringify({ repo: "o/r" }),
    });

    expect(res.result).toEqual({ ok: true, repo: "o/r" });
  });

  it("returns 400 when repo is not in owner/name form", async () => {
    const res = await bearer({ repo: "notarepo" });

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "repo must be in owner/name form" });
  });

  it("returns 400 when the date is not a valid ISO string", async () => {
    const res = await bearer({ repo: "o/r", date: "last tuesday" });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on a garbage JSON body", async () => {
    const res = await bearer("{not json");

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "invalid JSON body" });
  });

  it("returns 413 when the body exceeds the 1 MB cap", async () => {
    const res = await bearer("x".repeat(1_048_577));

    expect(res.statusCode).toBe(413);
  });

  it("returns 503 when the pool is null", async () => {
    const res = await bearer({ repo: "o/r" }, null);

    expect(res.statusCode).toBe(503);
    expect(res.result).toEqual({ error: "database unavailable" });
  });

  it("returns 500 when the upsert throws", async () => {
    const pool = makePool();

    pool.query.mockRejectedValue(new Error("db fail"));
    const res = await bearer({ repo: "o/r" }, pool);

    expect(res.statusCode).toBe(500);
  });

  it("upserts a direct-format incident", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const res = await bearer(
      { repo: "o/r", title: "down", severity: "high", url: "u" },
      pool,
    );

    expect(res.result).toEqual({ ok: true, repo: "o/r" });
  });

  it("maps a PagerDuty/Opsgenie envelope", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const res = await bearer(
      {
        incident: {
          service: { name: "o/r" },
          summary: "API down",
          urgency: "high",
          status: "resolved",
          html_url: "https://pd/1",
        },
      },
      pool,
    );

    expect(res.result).toEqual({ ok: true, repo: "o/r" });
  });

  it("derives resolved=true from status resolved and writes a FIFO-capped entry", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    await bearer({ repo: "o/r", title: "outage", status: "resolved" }, pool);
    const [sql, args] = pool.query.mock.calls[0];

    expect(sql).toContain("LIMIT 10");
    expect(JSON.parse(args[1])).toMatchObject({
      title: "outage",
      resolved: true,
      severity: "unknown",
    });
  });

  it("defaults title and severity when neither incident field is present", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    await bearer({ repo: "o/r" }, pool);
    const [, args] = pool.query.mock.calls[0];

    expect(JSON.parse(args[1])).toMatchObject({
      title: "Unknown incident",
      severity: "unknown",
      resolved: false,
    });
  });

  it("clamps a future date to now so it cannot pin the FIFO list", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    await bearer({ repo: "o/r", date: "2099-01-01T00:00:00.000Z" }, pool);
    const [, args] = pool.query.mock.calls[0];

    expect(JSON.parse(args[1]).date).toBe(new Date(Date.now()).toISOString());
  });
});
