import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { handleApiRoute } from "../../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const storage = vi.hoisted(() => {
  const file = { save: vi.fn(), exists: vi.fn(), download: vi.fn() };
  const bucketObj = { file: vi.fn(() => file) };
  class Storage {
    bucket() {
      return bucketObj;
    }
  }
  return { file, Storage };
});
vi.mock("@google-cloud/storage", () => ({ Storage: storage.Storage }));

const originalEnv = { ...process.env };
const get = (pool: unknown, url: string) => buildServer(() => pool as any).inject({ method: "GET", url, headers: AUTH });

describe("/api/task-logs", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  // POST is still served by the legacy dispatcher (Phase 6) — drive it there.
  describe("POST", () => {
    it("returns 400 when fields are missing", async () => {
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs", method: "POST", headers: AUTH, body: { task_id: "t" } }), res, null);
      expect(res.statusCode).toBe(400);
    });
    it("saves logs to storage", async () => {
      storage.file.save.mockResolvedValue(undefined);
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs", method: "POST", headers: AUTH, body: { task_id: "t", repo: "o/r", logs: "x" } }), res, null);
      expect(res.json).toEqual({ ok: true });
      expect(storage.file.save).toHaveBeenCalled();
    });
    it("returns 500 when storage throws", async () => {
      storage.file.save.mockRejectedValue(new Error("gcs"));
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs", method: "POST", headers: AUTH, body: { task_id: "t", repo: "o/r", logs: "x" } }), res, null);
      expect(res.statusCode).toBe(500);
    });
  });

  // GET is a native hapi route (Phase 5).
  describe("GET", () => {
    it("returns 400 when task_id is missing", async () => {
      const res = await get(null, "/api/task-logs?repo=o/r");
      expect(res.statusCode).toBe(400);
    });
    it("returns 503 when repo is omitted and no pool resolves it", async () => {
      const res = await get(null, "/api/task-logs?task_id=t");
      expect(res.statusCode).toBe(503);
    });
    it("resolves repo from task_id when repo is omitted", async () => {
      storage.file.exists.mockResolvedValue([false]);
      const pool = makePool();
      pool.query.mockResolvedValue({ rows: [{ target_repo: "o/r" }] });
      const res = await get(pool, "/api/task-logs?task_id=t");
      expect(res.result).toEqual({ logs: "", next_offset: 0, complete: false });
    });
    it("returns empty and incomplete when the log file does not exist", async () => {
      storage.file.exists.mockResolvedValue([false]);
      const res = await get(null, "/api/task-logs?task_id=t&repo=o/r");
      expect(res.result).toEqual({ logs: "", next_offset: 0, complete: false });
    });
    it("returns a slice from offset when the file exists", async () => {
      storage.file.exists.mockResolvedValue([true]);
      storage.file.download.mockResolvedValue([Buffer.from("hello world")]);
      const res = await get(null, "/api/task-logs?task_id=t&repo=o/r&offset=6");
      expect(res.result).toEqual({ logs: "world", next_offset: 11, complete: true });
    });
    it("returns 500 when storage throws", async () => {
      storage.file.exists.mockRejectedValue(new Error("gcs"));
      const res = await get(null, "/api/task-logs?task_id=t&repo=o/r");
      expect(res.statusCode).toBe(500);
    });
  });
});
