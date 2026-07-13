import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/pipeline/pipeline.js", () => ({
  createTask: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  retryTask: vi.fn(),
}));

import { listTasks } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";

const originalEnv = { ...process.env };
const get = (url: string) =>
  buildServer(() => null).inject({ method: "GET", url, headers: AUTH });

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
    vi.mocked(listTasks).mockResolvedValue({ tasks: [{ id: 1 }], total: 1 });
    await get("/api/tasks?status=pending&limit=5");
    expect(listTasks).toHaveBeenCalledWith("pending", 5, 0);
  });

  it("caps limit at 100", async () => {
    vi.mocked(listTasks).mockResolvedValue({ tasks: [], total: 0 });
    await get("/api/tasks?limit=999");
    expect(listTasks).toHaveBeenCalledWith(undefined, 100, 0);
  });

  it("defaults to limit 20 offset 0 and echoes them", async () => {
    vi.mocked(listTasks).mockResolvedValue({ tasks: [], total: 0 });
    const res = await get("/api/tasks");
    expect(listTasks).toHaveBeenCalledWith(undefined, 20, 0);
    expect(res.result).toMatchObject({ limit: 20, offset: 0 });
  });

  it("passes offset through and returns paging metadata alongside rows", async () => {
    vi.mocked(listTasks).mockResolvedValue({ tasks: [{ id: 2 }], total: 7 });
    const res = await get("/api/tasks?limit=5&offset=10");
    expect(listTasks).toHaveBeenCalledWith(undefined, 5, 10);
    expect(res.result).toEqual({
      tasks: [{ id: 2 }],
      total: 7,
      limit: 5,
      offset: 10,
    });
  });

  it("returns 400 for a negative offset", async () => {
    const res = await get("/api/tasks?offset=-1");
    expect(res.statusCode).toBe(400);
  });

  it("returns 500 when listTasks throws", async () => {
    vi.mocked(listTasks).mockRejectedValue(new Error("fail"));
    const res = await get("/api/tasks");
    expect(res.statusCode).toBe(500);
  });

  it("returns 400 when status has an invalid shape", async () => {
    const res = await get("/api/tasks?status=Broken!");
    expect(res.statusCode).toBe(400);
  });
});
