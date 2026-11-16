import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../work/repo/installation-repos.js", () => ({
  getInstallationRepos: vi.fn(),
}));

import { getInstallationRepos } from "../../../work/repo/installation-repos.js";

const originalEnv = { ...process.env };

const installed = (fullName: string) => {
  const [owner, name] = fullName.split("/");

  return { full_name: fullName, owner, name };
};

const poolOnboarding = (...fullNames: string[]) => {
  const pool = makePool();

  pool.query.mockResolvedValue({
    rows: fullNames.map((full_name) => ({ full_name })),
  });

  return pool;
};

const get = (pool: unknown) =>
  buildServer(() => pool as never).inject({
    method: "GET",
    url: "/api/repos/available",
    headers: AUTH,
  });

describe("GET /api/repos/available", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    expect((await get(null)).statusCode).toBe(503);
  });

  it("returns only the installation repos re-cinq/web and re-cinq/api that are not onboarded", async () => {
    vi.mocked(getInstallationRepos).mockResolvedValue([
      installed("re-cinq/lore"),
      installed("re-cinq/web"),
      installed("re-cinq/api"),
    ]);
    const res = await get(poolOnboarding("re-cinq/lore"));

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 200,
      body: [installed("re-cinq/web"), installed("re-cinq/api")],
    });
  });

  it("returns an empty list when every installation repo is onboarded", async () => {
    vi.mocked(getInstallationRepos).mockResolvedValue([
      installed("re-cinq/lore"),
    ]);
    const res = await get(poolOnboarding("re-cinq/lore"));

    expect(res.result).toEqual([]);
  });

  it("returns 424 with the reason when GitHub is not configured", async () => {
    vi.mocked(getInstallationRepos).mockRejectedValue(
      new Error("GitHub not configured. Set GITHUB_APP_ID"),
    );
    const res = await get(poolOnboarding());

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 424,
      body: { error: "GitHub not configured. Set GITHUB_APP_ID" },
    });
  });

  it("returns 500 with the upstream message when the GitHub read fails with Bad credentials", async () => {
    vi.mocked(getInstallationRepos).mockRejectedValue(
      Object.assign(new Error("Bad credentials"), { status: 401 }),
    );
    const res = await get(poolOnboarding());

    expect({ status: res.statusCode, body: res.result }).toEqual({
      status: 500,
      body: { error: "Bad credentials" },
    });
  });
});
