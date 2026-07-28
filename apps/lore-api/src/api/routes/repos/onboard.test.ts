import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../features/repo/repo-onboard.js", () => ({
  onboardRepo: vi.fn(),
}));

import { onboardRepo } from "../../../features/repo/repo-onboard.js";

const originalEnv = { ...process.env };
const post = (body: unknown, pool: unknown) =>
  buildServer(() => pool as any).inject({
    method: "POST",
    url: "/api/onboard",
    headers: AUTH,
    payload: JSON.stringify(body),
  });

const onboarded = {
  repo_id: "repo-1",
  task_id: "task-1",
  status: "onboarding-agent-spawned",
  webhook: { ok: true, hookId: 1, created: true },
} as const;

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
    const res = await post({ repo: "o/r" }, null);

    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when repo is missing or malformed", async () => {
    const res = await post({ repo: "noslash" }, makePool());

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with the onboard result", async () => {
    vi.mocked(onboardRepo).mockResolvedValue(onboarded);
    const res = await post({ repo: "o/r" }, makePool());

    expect(res.result).toMatchObject({ repo_id: "repo-1", task_id: "task-1" });
  });

  it("returns 409 with the reason when the guard blocks the submission", async () => {
    vi.mocked(onboardRepo).mockResolvedValue({
      blocked: "already-onboarded",
      error: "o/r is already onboarded.",
      task_id: null,
    });
    const res = await post({ repo: "o/r" }, makePool());

    expect(res.statusCode).toBe(409);
    expect(res.result).toMatchObject({ blocked: "already-onboarded" });
  });

  it("passes reonboard through to onboardRepo", async () => {
    vi.mocked(onboardRepo).mockResolvedValue(onboarded);
    await post({ repo: "o/r", reonboard: true }, makePool());

    expect(onboardRepo).toHaveBeenCalledWith(expect.anything(), "o/r", {
      reonboard: true,
    });
  });

  it("returns 500 when onboardRepo throws", async () => {
    vi.mocked(onboardRepo).mockRejectedValue(new Error("onboard fail"));
    const res = await post({ repo: "o/r" }, makePool());

    expect(res.statusCode).toBe(500);
  });
});
