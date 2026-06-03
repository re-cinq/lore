import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../test-helpers/http-mock.js";

vi.mock("../pipeline.js", () => ({ createTask: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(), retryTask: vi.fn() }));

import { listTasks } from "../pipeline.js";

const originalEnv = { ...process.env };

describe("GET /api/tasks", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("lists with status and limit", async () => {
    vi.mocked(listTasks).mockResolvedValue([{ id: 1 }] as any);
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks?status=pending&limit=5", headers: AUTH }), res, null);
    expect(listTasks).toHaveBeenCalledWith("pending", 5);
  });

  it("caps limit at 100", async () => {
    vi.mocked(listTasks).mockResolvedValue([] as any);
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks?limit=999", headers: AUTH }), res, null);
    expect(listTasks).toHaveBeenCalledWith(undefined, 100);
  });

  it("returns 500 when listTasks throws", async () => {
    vi.mocked(listTasks).mockRejectedValue(new Error("fail"));
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tasks", headers: AUTH }), res, null);
    expect(res.statusCode).toBe(500);
  });
});
