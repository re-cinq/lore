import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../features/repo/repo-onboard.js", () => ({ onboardRepo: vi.fn() }));

import { onboardRepo } from "../../../features/repo/repo-onboard.js";

const originalEnv = { ...process.env };

describe("POST /api/onboard", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/onboard", method: "POST", headers: AUTH, body: { repo: "o/r" } }), res, null);
    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when repo is missing or malformed", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/onboard", method: "POST", headers: AUTH, body: { repo: "noslash" } }), res, pool as any);
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with the onboard result", async () => {
    vi.mocked(onboardRepo).mockResolvedValue({ ok: true } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/onboard", method: "POST", headers: AUTH, body: { repo: "o/r" } }), res, pool as any);
    expect(res.json).toEqual({ ok: true });
  });

  it("returns 500 when onboardRepo throws", async () => {
    vi.mocked(onboardRepo).mockRejectedValue(new Error("onboard fail"));
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/onboard", method: "POST", headers: AUTH, body: { repo: "o/r" } }), res, pool as any);
    expect(res.statusCode).toBe(500);
  });
});
