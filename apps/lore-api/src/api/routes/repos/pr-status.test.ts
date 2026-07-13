import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../platform/github-client.js", () => ({
  fetchPrStatus: vi.fn(),
}));

import { fetchPrStatus } from "../../../platform/github-client.js";

const originalEnv = { ...process.env };
const get = (url: string) =>
  buildServer(() => null).inject({ method: "GET", url, headers: AUTH });

describe("GET /api/pr-status", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns the PR status for a valid repo and pr_number", async () => {
    vi.mocked(fetchPrStatus).mockResolvedValue({ state: "open" } as any);
    const res = await get("/api/pr-status?repo=o/r&pr_number=5");
    expect(vi.mocked(fetchPrStatus).mock.calls[0]).toEqual(["o/r", 5]);
    expect(res.result).toEqual({ state: "open" });
  });

  it("returns 424 when GitHub is not configured", async () => {
    vi.mocked(fetchPrStatus).mockResolvedValue(null as any);
    const res = await get("/api/pr-status?repo=o/r&pr_number=5");
    expect(res.statusCode).toBe(424);
  });

  it("returns 400 when repo is not owner/name", async () => {
    const res = await get("/api/pr-status?repo=notarepo&pr_number=5");
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when pr_number is missing", async () => {
    const res = await get("/api/pr-status?repo=o/r");
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when pr_number is not an integer", async () => {
    const res = await get("/api/pr-status?repo=o/r&pr_number=abc");
    expect(res.statusCode).toBe(400);
  });

  it("returns 500 when fetchPrStatus throws", async () => {
    vi.mocked(fetchPrStatus).mockRejectedValue(new Error("gh boom"));
    const res = await get("/api/pr-status?repo=o/r&pr_number=5");
    expect(res.statusCode).toBe(500);
  });
});
