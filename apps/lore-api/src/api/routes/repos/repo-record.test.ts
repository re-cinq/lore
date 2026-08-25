import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The route reads the row through the Project facade (projectFor → settings.record).
const fakeSettings = { record: vi.fn() };

vi.mock("../../../platform/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({ settings: fakeSettings })),
}));

import { projectFor } from "../../../platform/project-boot.js";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

/** What the port answers with: the `Repo` model, in the model's own casing. */
const RECORD = {
  id: "r1",
  owner: "re-cinq",
  name: "lore",
  fullName: "re-cinq/lore",
  team: "platform",
  onboardedAt: "2026-01-01",
  lastIngestedAt: "2026-08-01",
  onboardingPrUrl: null,
  onboardingPrMerged: true,
  settings: { trust: { level: "tests" } },
  outcomeStats: null,
};

/** What the ROUTE publishes: the same record keyed by its columns. */
const ROW = {
  id: "r1",
  owner: "re-cinq",
  name: "lore",
  full_name: "re-cinq/lore",
  team: "platform",
  onboarded_at: "2026-01-01",
  last_ingested_at: "2026-08-01",
  onboarding_pr_url: null,
  onboarding_pr_merged: true,
  settings: { trust: { level: "tests" } },
  outcome_stats: null,
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
    fakeSettings.record.mockResolvedValue(RECORD);

    const res = await get();

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual(ROW);
  });

  it("reads the row for the owner/repo pair in the path", async () => {
    fakeSettings.record.mockResolvedValue(RECORD);

    await get();

    expect(projectFor).toHaveBeenCalledWith("re-cinq/lore");
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
