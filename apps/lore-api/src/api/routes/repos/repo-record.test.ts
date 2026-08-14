import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The route reads the row through the Project facade (projectFor → settings.record).
const fakeSettings = { record: vi.fn() };

vi.mock("../../../platform/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({ settings: fakeSettings })),
}));

import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const ROW = {
  full_name: "re-cinq/lore",
  team: "platform",
  settings: { trust: { level: "tests" } },
  onboarded_at: "2026-01-01",
  last_ingested_at: "2026-08-01",
  onboarding_pr_url: null,
  onboarding_pr_merged: true,
};

describe("GET /api/repos/{owner}/{repo}", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(path = "/api/repos/re-cinq/lore") {
    return buildServer(() => makePool() as never).inject({
      method: "GET",
      url: path,
      headers: AUTH,
    });
  }

  it("returns the repo record", async () => {
    fakeSettings.record.mockResolvedValue(ROW);

    const res = await get();

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual(ROW);
  });

  it("reads the row for the owner/repo pair in the path", async () => {
    fakeSettings.record.mockResolvedValue(ROW);

    await get();

    expect(fakeSettings.record).toHaveBeenCalledWith("re-cinq/lore");
  });

  it("returns 404 for a repo with no row", async () => {
    fakeSettings.record.mockResolvedValue(null);

    const res = await get("/api/repos/re-cinq/unknown");

    expect(res.statusCode).toBe(404);
    expect(res.result).toEqual({ error: "Repo not found" });
  });

  it("returns 500 when the lookup throws", async () => {
    fakeSettings.record.mockRejectedValue(new Error("db down"));

    const res = await get();

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: "db down" });
  });
});
