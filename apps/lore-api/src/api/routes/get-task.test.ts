import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/pipeline/pipeline.js", () => ({ createTask: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(), retryTask: vi.fn() }));

import { getTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";

const originalEnv = { ...process.env };

describe("GET /api/task/:id", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns the task when found", async () => {
    vi.mocked(getTask).mockResolvedValue({ id: "t1" } as any);
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/task/t1", headers: AUTH }), res, null);
    expect(res.json).toEqual({ id: "t1" });
  });

  it("returns 404 when not found", async () => {
    vi.mocked(getTask).mockResolvedValue(null as any);
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/task/t1", headers: AUTH }), res, null);
    expect(res.statusCode).toBe(404);
  });

  it("returns 500 when getTask throws", async () => {
    vi.mocked(getTask).mockRejectedValue(new Error("boom"));
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/task/t1", headers: AUTH }), res, null);
    expect(res.statusCode).toBe(500);
  });
});
