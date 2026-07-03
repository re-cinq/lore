import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/pipeline/pipeline.js", () => ({ createTask: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(), retryTask: vi.fn() }));

import { listTasks } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";

const originalEnv = { ...process.env };
const get = (url: string) => buildServer(() => null).inject({ method: "GET", url, headers: AUTH });

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
    await get("/api/tasks?status=pending&limit=5");
    expect(listTasks).toHaveBeenCalledWith("pending", 5);
  });

  it("caps limit at 100", async () => {
    vi.mocked(listTasks).mockResolvedValue([] as any);
    await get("/api/tasks?limit=999");
    expect(listTasks).toHaveBeenCalledWith(undefined, 100);
  });

  it("returns 500 when listTasks throws", async () => {
    vi.mocked(listTasks).mockRejectedValue(new Error("fail"));
    const res = await get("/api/tasks");
    expect(res.statusCode).toBe(500);
  });
});
